using System.Globalization;

namespace ArxTask.Api.Tests;

public class WhatsAppDigestLogicTests
{
    static readonly DateOnly Today = new(2026, 11, 3);

    static DigestTaskItem Task(string title, string? date = "2026-11-03", string? time = null, string status = "open", bool habit = false, string? company = null) =>
        new(title, date, time, status, habit, company);

    // --- WhatsAppPhone ---------------------------------------------------------

    [Theory]
    [InlineData("0532 123 45 67", "+905321234567")]
    [InlineData("5321234567", "+905321234567")]
    [InlineData("+49 151 2345 6789", "+4915123456789")]
    [InlineData("0049-151-23456789", "+4915123456789")]
    [InlineData("(0532) 123-45-67", "+905321234567")]
    [InlineData("   ", "")]
    public void Normalize_accepts(string input, string expected) =>
        Assert.Equal(expected, WhatsAppPhone.Normalize(input));

    [Theory]
    [InlineData("abc")]
    [InlineData("123")]
    [InlineData("+12")]
    [InlineData("+1234567890123456")]
    public void Normalize_rejects(string input) => Assert.Null(WhatsAppPhone.Normalize(input));

    [Fact]
    public void ToGraphRecipient_strips_plus() =>
        Assert.Equal("905321234567", WhatsAppPhone.ToGraphRecipient("+905321234567"));

    // --- WhatsAppDigestComposer -------------------------------------------------

    [Fact]
    public void Compose_orders_timed_first_and_appends_company()
    {
        var content = WhatsAppDigestComposer.Compose("Mehmet Fatih", "m@x.com",
        [
            Task("Süt al"),
            Task("Teklif gönder", time: "14:00", company: "Mara Market"),
            Task("Montaja git", time: "10:00", company: "Ensar Döner")
        ], Today);

        Assert.NotNull(content);
        Assert.Equal("10:00 Montaja git (Ensar Döner) • 14:00 Teklif gönder (Mara Market) • Süt al", content.ListParam);
        Assert.Equal("Mehmet", content.NameParam);
        Assert.Equal("Günaydın Mehmet, bugün yapılacakların: " + content.ListParam, content.PreviewText);
        Assert.Equal(3, content.TodayCount);
    }

    [Fact]
    public void Compose_returns_null_when_no_task_today() =>
        Assert.Null(WhatsAppDigestComposer.Compose("Mehmet", "m@x.com", [Task("Dünkü iş", date: "2026-11-02")], Today));

    [Fact]
    public void Compose_excludes_done_habits_and_pending_approval()
    {
        var content = WhatsAppDigestComposer.Compose("Mehmet", "m@x.com",
        [
            Task("Bitti", status: "done"),
            Task("Kitap okumak", habit: true),
            Task("Onayda", status: "pending_approval"),
            Task("Ara")
        ], Today);

        Assert.NotNull(content);
        Assert.Equal("Ara", content.ListParam);
        Assert.Equal(1, content.TodayCount);
    }

    [Fact]
    public void Compose_counts_overdue_from_earlier_dates()
    {
        var content = WhatsAppDigestComposer.Compose("Mehmet", "m@x.com",
        [
            Task("Bugünkü"),
            Task("Dün saatli", date: "2026-11-02", time: "09:00"),
            Task("Geçen hafta saatsiz", date: "2026-10-27"),
            Task("Eski ama bitti", date: "2026-10-20", status: "done"),
            Task("Eski alışkanlık", date: "2026-10-01", habit: true)
        ], Today);

        Assert.NotNull(content);
        Assert.Equal("Bugünkü • Ayrıca 2 gecikmiş işin var.", content.ListParam);
    }

    [Fact]
    public void Compose_caps_at_15()
    {
        var tasks = Enumerable.Range(1, 18).Select(i => Task($"İş {i}", time: $"{6 + i / 2:00}:{(i % 2) * 30:00}")).ToList();
        var content = WhatsAppDigestComposer.Compose("Mehmet", "m@x.com", tasks, Today);

        Assert.NotNull(content);
        var parts = content.ListParam.Split(" • ");
        Assert.Equal(16, parts.Length);
        Assert.Equal("+3 görev daha", parts[^1]);
        Assert.Equal(18, content.TodayCount);
    }

    [Fact]
    public void Compose_sanitizes_whitespace()
    {
        var content = WhatsAppDigestComposer.Compose("Mehmet", "m@x.com", [Task("Ara\n  ve\t     sor")], Today);

        Assert.NotNull(content);
        Assert.Equal("Ara ve sor", content.ListParam);
        Assert.DoesNotContain('\n', content.ListParam);
        Assert.DoesNotContain('\t', content.ListParam);
    }

    [Fact]
    public void Compose_keeps_list_param_under_meta_limit()
    {
        var longTitle = new string('x', 200);
        var tasks = Enumerable.Range(1, 15).Select(i => Task($"{longTitle}{i}")).ToList();
        var content = WhatsAppDigestComposer.Compose("Mehmet", "m@x.com", tasks, Today);

        Assert.NotNull(content);
        Assert.True(content.ListParam.Length <= 900, $"length {content.ListParam.Length}");
        Assert.EndsWith("görev daha", content.ListParam);
    }

    [Fact]
    public void Compose_name_falls_back_to_email_local_part()
    {
        var content = WhatsAppDigestComposer.Compose("", "ali@x.com", [Task("Ara")], Today);
        Assert.NotNull(content);
        Assert.Equal("ali", content.NameParam);
    }

    [Fact]
    public void ComposeEmpty_text()
    {
        var content = WhatsAppDigestComposer.ComposeEmpty("Mehmet", "m@x.com");
        Assert.Equal("Bugün planlanmış görevin yok.", content.ListParam);
        Assert.Equal("Günaydın Mehmet, bugün yapılacakların: Bugün planlanmış görevin yok.", content.PreviewText);
        Assert.Equal(0, content.TodayCount);
    }

    // --- WhatsAppDigestSchedule -------------------------------------------------

    [Theory]
    [InlineData("2026-11-03 07:59", "08:00", false)]
    [InlineData("2026-11-03 08:00", "08:00", true)]
    [InlineData("2026-11-03 08:59", "08:00", true)]
    [InlineData("2026-11-03 09:00", "08:00", false)]
    [InlineData("2026-11-03 23:55", "23:50", true)]
    [InlineData("2026-11-04 00:10", "23:50", false)]
    [InlineData("2026-11-03 08:00", "bozuk", false)]
    public void ShouldSend_window(string now, string chosen, bool expected)
    {
        var localNow = DateTime.ParseExact(now, "yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
        Assert.Equal(expected, WhatsAppDigestSchedule.ShouldSend(localNow, chosen));
    }

    // --- WhatsAppSettingsRules --------------------------------------------------

    [Fact]
    public void Rules_enabling_without_number_fails()
    {
        var user = new AppUser();
        Assert.NotNull(WhatsAppSettingsRules.Apply(user, null, true, null));
        Assert.False(user.WhatsAppDigestEnabled);
    }

    [Fact]
    public void Rules_invalid_number_fails()
    {
        var user = new AppUser();
        Assert.Equal("Geçersiz WhatsApp numarası.", WhatsAppSettingsRules.Apply(user, "abc", null, null));
        Assert.Equal("", user.WhatsAppNumber);
    }

    [Fact]
    public void Rules_number_and_enable_in_one_request()
    {
        var user = new AppUser();
        Assert.Null(WhatsAppSettingsRules.Apply(user, "0532 123 45 67", true, null));
        Assert.Equal("+905321234567", user.WhatsAppNumber);
        Assert.True(user.WhatsAppDigestEnabled);
    }

    [Fact]
    public void Rules_clearing_number_disables()
    {
        var user = new AppUser();
        Assert.Null(WhatsAppSettingsRules.Apply(user, "+905321234567", true, null));
        Assert.Null(WhatsAppSettingsRules.Apply(user, "", null, null));
        Assert.False(user.WhatsAppDigestEnabled);
        Assert.Equal("", user.WhatsAppNumber);
    }

    [Fact]
    public void Rules_invalid_time_fails()
    {
        var user = new AppUser();
        Assert.NotNull(WhatsAppSettingsRules.Apply(user, null, null, "25:00"));
        Assert.Equal("08:00", user.WhatsAppDigestTime);
        Assert.Null(WhatsAppSettingsRules.Apply(user, null, null, "07:15"));
        Assert.Equal("07:15", user.WhatsAppDigestTime);
    }

    [Fact]
    public void Rules_defaults()
    {
        var user = new AppUser();
        Assert.False(user.WhatsAppDigestEnabled);
        Assert.Equal("08:00", user.WhatsAppDigestTime);
        Assert.Equal("", user.WhatsAppNumber);
    }
}
