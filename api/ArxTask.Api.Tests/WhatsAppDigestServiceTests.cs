using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Time.Testing;

namespace ArxTask.Api.Tests;

public sealed class WhatsAppDigestServiceTests : IDisposable
{
    const string UserId = "user-1";
    readonly SqliteConnection connection = new("Data Source=:memory:");
    readonly ArxTaskDbContext db;
    readonly FakeSender sender = new();
    readonly FakeTimeProvider clock = new();
    readonly WhatsAppDigestService service;

    public WhatsAppDigestServiceTests()
    {
        connection.Open();
        db = new ArxTaskDbContext(new DbContextOptionsBuilder<ArxTaskDbContext>().UseSqlite(connection).Options);
        db.Database.EnsureCreated();
        db.Users.Add(new AppUser
        {
            Id = UserId,
            Email = "mehmet@x.com",
            Name = "Mehmet",
            WhatsAppNumber = "+905321234567",
            WhatsAppDigestEnabled = true,
            WhatsAppDigestTime = "08:00"
        });
        db.Companies.Add(new CompanyEntity { Id = "c1", UserId = UserId, Name = "Ensar Döner" });
        db.SaveChanges();
        service = new WhatsAppDigestService(db, sender, clock);
        At("2026-11-03 07:00");
    }

    public void Dispose()
    {
        db.Dispose();
        connection.Dispose();
    }

    // Türkiye yerel saatini (UTC+3) ayarlar.
    void At(string local) =>
        clock.SetUtcNow(new DateTimeOffset(DateTime.Parse(local, System.Globalization.CultureInfo.InvariantCulture), TimeSpan.FromHours(3)));

    void AddTask(string title, string date = "2026-11-03", string? time = null, string? companyId = null)
    {
        db.Tasks.Add(new BusinessTaskEntity { Id = Ids.New("task"), UserId = UserId, Title = title, DueDate = date, DueTime = time, CompanyId = companyId });
        db.SaveChanges();
    }

    void UpdateUser(Action<AppUser> change)
    {
        change(db.Users.Single(user => user.Id == UserId));
        db.SaveChanges();
    }

    // SQLite DateTimeOffset ile ORDER BY yapamaz; sıralama bellekte.
    List<WhatsAppMessageEntity> Log() => db.WhatsAppMessages.AsNoTracking().ToList().OrderBy(item => item.CreatedAt).ToList();

    [Fact]
    public async Task Sends_once_inside_window()
    {
        AddTask("Montaja git", time: "10:00", companyId: "c1");
        At("2026-11-03 08:05");
        await service.RunDueDigestsAsync();
        At("2026-11-03 08:10");
        await service.RunDueDigestsAsync();

        var sent = Assert.Single(sender.Sent);
        Assert.Equal("+905321234567", sent.To);
        Assert.Equal("10:00 Montaja git (Ensar Döner)", sent.Content.ListParam);
        var entry = Assert.Single(Log());
        Assert.Equal(("scheduled", "sent", "2026-11-03"), (entry.Kind, entry.Status, entry.Date));
        Assert.Equal(sent.Content.PreviewText, entry.Body);
    }

    [Fact]
    public async Task Does_not_send_before_chosen_time()
    {
        AddTask("Ara");
        At("2026-11-03 07:55");
        await service.RunDueDigestsAsync();
        Assert.Empty(sender.Sent);
        Assert.Empty(Log());
    }

    [Theory]
    [InlineData(false, "+905321234567")]
    [InlineData(true, "")]
    public async Task Skips_disabled_or_no_number(bool enabled, string number)
    {
        AddTask("Ara");
        UpdateUser(user => { user.WhatsAppDigestEnabled = enabled; user.WhatsAppNumber = number; });
        At("2026-11-03 08:05");
        await service.RunDueDigestsAsync();
        Assert.Empty(sender.Sent);
        Assert.Empty(Log());
    }

    [Fact]
    public async Task Skips_when_no_task_today()
    {
        AddTask("Dünkü", date: "2026-11-02");
        At("2026-11-03 08:05");
        await service.RunDueDigestsAsync();
        Assert.Empty(sender.Sent);
        Assert.Empty(Log());
    }

    [Fact]
    public async Task Failed_blocks_rest_of_day()
    {
        AddTask("Ara");
        sender.NextStatus = "failed";
        At("2026-11-03 08:05");
        await service.RunDueDigestsAsync();
        sender.NextStatus = "sent";
        At("2026-11-03 08:10");
        await service.RunDueDigestsAsync();

        Assert.Single(sender.Sent);
        Assert.Equal("failed", Assert.Single(Log()).Status);
    }

    [Fact]
    public async Task Sender_exception_is_logged_as_failed()
    {
        AddTask("Ara");
        sender.Throw = true;
        At("2026-11-03 08:05");
        await service.RunDueDigestsAsync();
        Assert.Equal("failed", Assert.Single(Log()).Status);
    }

    [Fact]
    public async Task In_flight_send_blocks_overlapping_run()
    {
        // Başka bir (üst üste binen) çalıştırma bu kullanıcı için gönderime başlamış.
        AddTask("Ara");
        db.WhatsAppMessages.Add(new WhatsAppMessageEntity
        {
            Id = "wa-inflight", UserId = UserId, Date = "2026-11-03", Kind = "scheduled",
            ToNumber = "+905321234567", Body = "", Status = "sending", CreatedAt = clock.GetUtcNow()
        });
        db.SaveChanges();
        At("2026-11-03 08:05");
        await service.RunDueDigestsAsync();
        Assert.Empty(sender.Sent);
    }

    [Fact]
    public async Task Record_is_reserved_before_sending()
    {
        AddTask("Ara");
        string? statusSeenDuringSend = null;
        sender.OnSend = () =>
        {
            using var other = new ArxTaskDbContext(new DbContextOptionsBuilder<ArxTaskDbContext>().UseSqlite(connection).Options);
            statusSeenDuringSend = other.WhatsAppMessages.Select(item => item.Status).SingleOrDefault();
        };
        At("2026-11-03 08:05");
        await service.RunDueDigestsAsync();

        Assert.Equal("sending", statusSeenDuringSend);
        Assert.Equal("sent", Assert.Single(Log()).Status);
    }

    [Fact]
    public async Task Dry_run_logged_once_per_day()
    {
        AddTask("Ara");
        sender.IsConfigured = false;
        At("2026-11-03 08:05");
        await service.RunDueDigestsAsync();
        At("2026-11-03 08:10");
        await service.RunDueDigestsAsync();

        Assert.Empty(sender.Sent);
        Assert.Equal("dry-run", Assert.Single(Log()).Status);
    }

    [Fact]
    public async Task Real_send_allowed_after_dry_run()
    {
        AddTask("Ara");
        sender.IsConfigured = false;
        At("2026-11-03 08:05");
        await service.RunDueDigestsAsync();
        sender.IsConfigured = true;
        At("2026-11-03 08:20");
        await service.RunDueDigestsAsync();

        Assert.Single(sender.Sent);
        Assert.Equal(["dry-run", "sent"], Log().Select(item => item.Status));
    }

    [Fact]
    public async Task Next_day_sends_again()
    {
        AddTask("Bugün", date: "2026-11-03");
        AddTask("Yarın", date: "2026-11-04");
        At("2026-11-03 08:05");
        await service.RunDueDigestsAsync();
        At("2026-11-04 08:05");
        await service.RunDueDigestsAsync();

        Assert.Equal(2, sender.Sent.Count);
        Assert.Equal(["2026-11-03", "2026-11-04"], Log().Select(item => item.Date));
    }

    [Fact]
    public async Task Test_does_not_block_scheduled()
    {
        AddTask("Ara");
        At("2026-11-03 07:30");
        var test = await service.SendTestAsync(UserId);
        Assert.Equal("sent", test.Status);
        At("2026-11-03 08:05");
        await service.RunDueDigestsAsync();

        Assert.Equal(2, sender.Sent.Count);
        Assert.Equal(["test", "scheduled"], Log().Select(item => item.Kind));
    }

    [Fact]
    public async Task Test_limit_three_per_day()
    {
        AddTask("Ara");
        for (var i = 0; i < 3; i++) Assert.Equal("sent", (await service.SendTestAsync(UserId)).Status);
        var fourth = await service.SendTestAsync(UserId);

        Assert.Equal("preview-only", fourth.Status);
        Assert.Equal("Günaydın Mehmet, bugün yapılacakların: Ara", fourth.Preview);
        Assert.Equal(3, sender.Sent.Count);
    }

    [Fact]
    public async Task Test_limit_counts_dry_run_tests()
    {
        // Bağlantı yokken de test kayıtları günde 3'ten fazla birikmez.
        sender.IsConfigured = false;
        for (var i = 0; i < 3; i++) Assert.Equal("dry-run", (await service.SendTestAsync(UserId)).Status);
        Assert.Equal("preview-only", (await service.SendTestAsync(UserId)).Status);
        Assert.Equal(3, Log().Count);
    }

    [Fact]
    public void Messages_are_indexed_for_daily_lookup()
    {
        var entity = db.Model.FindEntityType(typeof(WhatsAppMessageEntity))!;
        Assert.Contains(entity.GetIndexes(), index =>
            index.Properties.Select(property => property.Name).SequenceEqual(["UserId", "Date", "Kind"]));
    }

    [Fact]
    public async Task Test_without_tasks_sends_empty_text()
    {
        var result = await service.SendTestAsync(UserId);
        Assert.Equal("Günaydın Mehmet, bugün yapılacakların: Bugün planlanmış görevin yok.", result.Preview);
        Assert.Equal("Bugün planlanmış görevin yok.", Assert.Single(sender.Sent).Content.ListParam);
    }

    [Fact]
    public async Task Test_works_while_digest_disabled()
    {
        UpdateUser(user => user.WhatsAppDigestEnabled = false);
        Assert.Equal("sent", (await service.SendTestAsync(UserId)).Status);
    }

    [Fact]
    public async Task Test_without_number()
    {
        UpdateUser(user => { user.WhatsAppDigestEnabled = false; user.WhatsAppNumber = ""; });
        var result = await service.SendTestAsync(UserId);
        Assert.Equal("no-number", result.Status);
        Assert.Empty(sender.Sent);
    }

    [Fact]
    public async Task Test_dry_run_when_unconfigured()
    {
        sender.IsConfigured = false;
        var result = await service.SendTestAsync(UserId);
        Assert.Equal("dry-run", result.Status);
        Assert.Equal("dry-run", Assert.Single(Log()).Status);
    }
}

sealed class FakeSender : IWhatsAppSender
{
    public bool IsConfigured { get; set; } = true;
    public string NextStatus { get; set; } = "sent";
    public bool Throw { get; set; }
    public Action? OnSend { get; set; }
    public List<(string To, WhatsAppDigestContent Content)> Sent { get; } = [];

    public Task<WhatsAppSendResult> SendDigestAsync(string toE164, WhatsAppDigestContent content, CancellationToken ct = default)
    {
        OnSend?.Invoke();
        if (Throw) throw new InvalidOperationException("boom");
        if (!IsConfigured) return Task.FromResult(new WhatsAppSendResult("dry-run", null, null));
        Sent.Add((toE164, content));
        return Task.FromResult(new WhatsAppSendResult(NextStatus, NextStatus == "sent" ? "wamid.1" : null, NextStatus == "sent" ? null : "error"));
    }
}
