using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

// ---------------------------------------------------------------------------
// WhatsApp sabah özeti: kullanıcıya kendi seçtiği saatte o günün görevleri.
// Tasarım: docs/superpowers/specs/2026-11-03-whatsapp-sabah-ozeti-design.md
// ---------------------------------------------------------------------------

// WhatsApp numaralarını E.164 biçimine ("+905321234567") çevirir.
public static class WhatsAppPhone
{
    // Boş girişte "" (numarayı sil), geçersizde null döner.
    public static string? Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return "";
        var value = Regex.Replace(input.Trim(), @"[\s\-().]", "");
        if (value.StartsWith("00")) value = "+" + value[2..];
        if (!value.StartsWith('+'))
        {
            // Türkiye yerel yazımları: 05xx... ya da 5xx...
            if (value.Length == 11 && value[0] == '0') value = "+90" + value[1..];
            else if (value.Length == 10 && value[0] == '5') value = "+90" + value;
            else return null;
        }
        return Regex.IsMatch(value, @"^\+[0-9]{8,15}$") ? value : null;
    }

    // Graph API "to" alanı baştaki "+" olmadan numara ister.
    public static string ToGraphRecipient(string e164) => e164.TrimStart('+');
}

public sealed record DigestTaskItem(string Title, string? DueDate, string? DueTime, string Status, bool IsHabit, string? CompanyName);

// NameParam / ListParam şablonun {{1}} / {{2}} değişkenleridir.
public sealed record WhatsAppDigestContent(string NameParam, string ListParam, string PreviewText, int TodayCount);

public static class WhatsAppDigestComposer
{
    const int MaxItems = 15;
    // Meta gövde metni 1024 karakterle sınırlı; şablonun sabit kısmına yer bırakılır.
    const int MaxListLength = 900;
    const string Separator = " • ";
    const string EmptyText = "Bugün planlanmış görevin yok.";

    // Bugün görevi yoksa null döner (o gün mesaj gitmez).
    public static WhatsAppDigestContent? Compose(string userName, string userEmail, IReadOnlyList<DigestTaskItem> tasks, DateOnly today)
    {
        var open = tasks.Where(item => !item.IsHabit && item.Status is not ("done" or "pending_approval")).ToList();
        var todayText = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var todays = open
            .Where(item => item.DueDate == todayText)
            .Select((item, index) => (item, index, time: ParseTime(item.DueTime)))
            .OrderBy(entry => entry.time is null)
            .ThenBy(entry => entry.time)
            .ThenBy(entry => entry.index)
            .Select(entry => FormatLine(entry.item, entry.time))
            .ToList();
        if (todays.Count == 0) return null;

        var overdue = open.Count(item =>
            DateOnly.TryParseExact(item.DueDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var due) && due < today);

        var list = BuildList(todays, overdue);
        return Build(userName, userEmail, list, todays.Count);
    }

    // "Test mesajı" için: bugün görev yokken gösterilen metin.
    public static WhatsAppDigestContent ComposeEmpty(string userName, string userEmail) =>
        Build(userName, userEmail, EmptyText, 0);

    static WhatsAppDigestContent Build(string userName, string userEmail, string list, int count)
    {
        var name = FirstName(userName, userEmail);
        return new WhatsAppDigestContent(name, list, $"Günaydın {name}, bugün yapılacakların: {list}", count);
    }

    // En fazla MaxItems satır ve MaxListLength karakter; sığmayanlar "+N görev daha" olur.
    static string BuildList(List<string> lines, int overdue)
    {
        var overdueText = overdue > 0 ? $"Ayrıca {overdue} gecikmiş işin var." : null;
        for (var shown = Math.Min(lines.Count, MaxItems); shown >= 1; shown--)
        {
            var parts = lines.Take(shown).ToList();
            if (shown < lines.Count) parts.Add($"+{lines.Count - shown} görev daha");
            if (overdueText is not null) parts.Add(overdueText);
            var text = string.Join(Separator, parts);
            if (text.Length <= MaxListLength) return text;
        }

        // Tek satır bile sığmıyorsa satırı kırp.
        var tail = (lines.Count > 1 ? $"{Separator}+{lines.Count - 1} görev daha" : "") + (overdueText is null ? "" : Separator + overdueText);
        var first = lines[0];
        var room = Math.Max(1, MaxListLength - tail.Length - 1);
        return (first.Length > room ? first[..room].TrimEnd() + "…" : first) + tail;
    }

    static string FormatLine(DigestTaskItem item, TimeOnly? time)
    {
        var title = Clean(item.Title);
        var company = Clean(item.CompanyName);
        var line = time is null ? title : $"{time.Value:HH\\:mm} {title}";
        return string.IsNullOrEmpty(company) ? line : $"{line} ({company})";
    }

    static TimeOnly? ParseTime(string? value) =>
        TimeOnly.TryParseExact(value?.Trim(), "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time) ? time : null;

    // Meta şablon değişkenleri satır sonu, sekme ve 4'ten fazla ardışık boşluk kabul etmez.
    static string Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? "" : Regex.Replace(value, @"\s+", " ").Trim();

    static string FirstName(string userName, string userEmail)
    {
        var name = Clean(userName).Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        if (!string.IsNullOrEmpty(name)) return name;
        var local = Clean(userEmail).Split('@')[0];
        return string.IsNullOrEmpty(local) ? "Planix kullanıcısı" : local;
    }
}

public static class WhatsAppDigestSchedule
{
    // Seçilen saatten sonra bu kadar süre içinde gönderilir; sonrası o gün için kaçırılmış sayılır
    // (sunucu saatler sonra kalkarsa beklenmedik saatte mesaj gitmesin).
    public static readonly TimeSpan CatchUpWindow = TimeSpan.FromMinutes(60);

    public static bool ShouldSend(DateTime localNow, string chosenTime)
    {
        if (!TimeOnly.TryParseExact(chosenTime, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var chosen)) return false;
        var start = chosen.ToTimeSpan();
        // Pencere gece yarısında kesilir: ertesi gün "dünün" mesajı gitmez.
        var end = TimeSpan.FromTicks(Math.Min((start + CatchUpWindow).Ticks, TimeSpan.FromDays(1).Ticks));
        var now = localNow.TimeOfDay;
        return now >= start && now < end;
    }
}

public static class WhatsAppSettingsRules
{
    // Ayarları doğrular ve kullanıcıya uygular; hata metni ya da null döner.
    // Hata durumunda kullanıcıya hiçbir değişiklik yazılmaz.
    public static string? Apply(AppUser user, string? number, bool? enabled, string? time)
    {
        string? normalized = null;
        if (number is not null)
        {
            normalized = WhatsAppPhone.Normalize(number);
            if (normalized is null) return "Geçersiz WhatsApp numarası.";
        }

        if (time is not null && !TimeOnly.TryParseExact(time.Trim(), "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
        {
            return "Geçersiz saat. SS:dd biçiminde olmalı (ör. 08:00).";
        }

        var finalNumber = normalized ?? user.WhatsAppNumber;
        var finalEnabled = enabled ?? user.WhatsAppDigestEnabled;
        if (finalNumber.Length == 0)
        {
            if (enabled == true) return "Önce WhatsApp numaranı gir.";
            finalEnabled = false;
        }

        user.WhatsAppNumber = finalNumber;
        user.WhatsAppDigestEnabled = finalEnabled;
        if (time is not null) user.WhatsAppDigestTime = time.Trim();
        return null;
    }
}

// Her gönderim denemesinin kaydı; "günde bir kez" kuralının dayanağı.
public sealed class WhatsAppMessageEntity : IOwnedEntity
{
    public string UserId { get; set; } = "";
    public string Id { get; set; } = "";
    public string Date { get; set; } = "";          // yyyy-MM-dd (Türkiye saati)
    public string Kind { get; set; } = "scheduled"; // scheduled | test
    public string ToNumber { get; set; } = "";
    public string Body { get; set; } = "";
    public string Status { get; set; } = "";        // sent | dry-run | failed
    public string? ProviderMessageId { get; set; }
    public string? Error { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed record WhatsAppSendResult(string Status, string? ProviderMessageId, string? Error);

public interface IWhatsAppSender
{
    bool IsConfigured { get; }
    Task<WhatsAppSendResult> SendDigestAsync(string toE164, WhatsAppDigestContent content, CancellationToken ct = default);
}

// Meta WhatsApp Cloud API ile onaylı şablon mesajı gönderir. AccessToken veya PhoneNumberId
// boşsa hiçbir istek atmaz ve "dry-run" döner.
public sealed class WhatsAppCloudSender(IHttpClientFactory httpClientFactory, IConfiguration configuration) : IWhatsAppSender
{
    string? Setting(string key)
    {
        var value = configuration[$"WhatsApp:{key}"];
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    public bool IsConfigured => Setting("AccessToken") is not null && Setting("PhoneNumberId") is not null;

    public async Task<WhatsAppSendResult> SendDigestAsync(string toE164, WhatsAppDigestContent content, CancellationToken ct = default)
    {
        if (!IsConfigured) return new WhatsAppSendResult("dry-run", null, null);

        var version = Setting("ApiVersion") ?? "v23.0";
        var url = $"https://graph.facebook.com/{version}/{Setting("PhoneNumberId")}/messages";
        var payload = BuildTemplatePayload(
            WhatsAppPhone.ToGraphRecipient(toE164),
            Setting("TemplateName") ?? "planix_sabah_ozeti",
            Setting("TemplateLanguage") ?? "tr",
            content.NameParam,
            content.ListParam);

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Setting("AccessToken"));
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(20);
            using var response = await client.SendAsync(request, ct);
            var body = await response.Content.ReadAsStringAsync(ct);
            JsonNode? node = null;
            try { node = JsonNode.Parse(body); } catch (JsonException) { }

            if (!response.IsSuccessStatusCode)
            {
                var message = node?["error"]?["message"]?.GetValue<string>() ?? $"HTTP {(int)response.StatusCode}";
                return new WhatsAppSendResult("failed", null, message);
            }

            return new WhatsAppSendResult("sent", node?["messages"]?[0]?["id"]?.GetValue<string>(), null);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            // Hata metni yalnızca istisna mesajını taşır; başlıklar/anahtar loglanmaz.
            return new WhatsAppSendResult("failed", null, exception.Message);
        }
    }

    public static string BuildTemplatePayload(string recipient, string templateName, string language, string nameParam, string listParam) =>
        JsonSerializer.Serialize(new
        {
            messaging_product = "whatsapp",
            to = recipient,
            type = "template",
            template = new
            {
                name = templateName,
                language = new { code = language },
                components = new object[]
                {
                    new
                    {
                        type = "body",
                        parameters = new object[]
                        {
                            new { type = "text", text = nameParam },
                            new { type = "text", text = listParam }
                        }
                    }
                }
            }
        });
}

public sealed record WhatsAppTestResult(string Preview, string Status, string? Error);

public interface IWhatsAppDigestService
{
    Task RunDueDigestsAsync();
    Task<WhatsAppTestResult> SendTestAsync(string userId);
}

public sealed class WhatsAppDigestService(
    ArxTaskDbContext db,
    IWhatsAppSender sender,
    TimeProvider clock,
    ILogger<WhatsAppDigestService>? logger = null) : IWhatsAppDigestService
{
    // Her test mesajı ücretli olduğu için kullanıcı başına günlük gerçek test sınırı.
    const int MaxTestsPerDay = 3;

    (DateTime Local, DateOnly Today, string TodayText) Now()
    {
        var local = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), AppTime.UserZone).DateTime;
        var today = DateOnly.FromDateTime(local);
        return (local, today, today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    }

    // Hangfire her 5 dakikada çağırır; saati gelen ve o gün henüz almamış kullanıcılara gönderir.
    public async Task RunDueDigestsAsync()
    {
        var (local, today, todayText) = Now();
        var users = await db.Users.Where(user => user.WhatsAppDigestEnabled && user.WhatsAppNumber != "").ToListAsync();
        foreach (var user in users)
        {
            try
            {
                if (!WhatsAppDigestSchedule.ShouldSend(local, user.WhatsAppDigestTime)) continue;

                var statuses = await db.WhatsAppMessages
                    .Where(item => item.UserId == user.Id && item.Date == todayText && item.Kind == "scheduled")
                    .Select(item => item.Status)
                    .ToListAsync();
                // Gönderilmiş ya da başarısız denenmiş gün tekrar denenmez (zaman aşımında Meta mesajı
                // iletmiş olabilir). Dry-run günü tüketmez ama bağlantı yokken tekrar kaydedilmez.
                if (statuses.Any(status => status is "sent" or "failed")) continue;
                if (statuses.Contains("dry-run") && !sender.IsConfigured) continue;

                var content = WhatsAppDigestComposer.Compose(user.Name, user.Email, await LoadTasks(user.Id), today);
                if (content is null) continue;
                await SendAndLog(user, "scheduled", content, todayText);
            }
            catch (Exception exception)
            {
                // Tek kullanıcıdaki hata diğerlerinin gönderimini durdurmaz.
                logger?.LogError(exception, "WhatsApp sabah özeti {UserId} için işlenemedi", user.Id);
            }
        }
    }

    public async Task<WhatsAppTestResult> SendTestAsync(string userId)
    {
        var user = await db.Users.FindAsync(userId);
        if (user is null) return new WhatsAppTestResult("", "no-number", "Kullanıcı bulunamadı.");

        var (_, today, todayText) = Now();
        var content = WhatsAppDigestComposer.Compose(user.Name, user.Email, await LoadTasks(user.Id), today)
            ?? WhatsAppDigestComposer.ComposeEmpty(user.Name, user.Email);
        if (string.IsNullOrEmpty(user.WhatsAppNumber)) return new WhatsAppTestResult(content.PreviewText, "no-number", null);

        var realTests = await db.WhatsAppMessages.CountAsync(item =>
            item.UserId == user.Id && item.Date == todayText && item.Kind == "test" && item.Status != "dry-run");
        if (realTests >= MaxTestsPerDay) return new WhatsAppTestResult(content.PreviewText, "preview-only", null);

        var result = await SendAndLog(user, "test", content, todayText);
        return new WhatsAppTestResult(content.PreviewText, result.Status, result.Error);
    }

    async Task<List<DigestTaskItem>> LoadTasks(string userId)
    {
        var companies = await db.Companies.Where(item => item.UserId == userId).ToDictionaryAsync(item => item.Id, item => item.Name);
        var tasks = await db.Tasks.Where(item => item.UserId == userId && item.Status != "done").ToListAsync();
        return tasks
            .Select(item => new DigestTaskItem(
                item.Title,
                item.DueDate,
                item.DueTime,
                item.Status,
                item.IsHabit,
                item.CompanyId is not null && companies.TryGetValue(item.CompanyId, out var name) ? name : null))
            .ToList();
    }

    async Task<WhatsAppSendResult> SendAndLog(AppUser user, string kind, WhatsAppDigestContent content, string todayText)
    {
        WhatsAppSendResult result;
        try
        {
            result = await sender.SendDigestAsync(user.WhatsAppNumber, content);
        }
        catch (Exception exception)
        {
            result = new WhatsAppSendResult("failed", null, exception.Message);
        }

        db.WhatsAppMessages.Add(new WhatsAppMessageEntity
        {
            Id = Ids.New("wa"),
            UserId = user.Id,
            Date = todayText,
            Kind = kind,
            ToNumber = user.WhatsAppNumber,
            Body = content.PreviewText,
            Status = result.Status,
            ProviderMessageId = result.ProviderMessageId,
            Error = result.Error,
            CreatedAt = clock.GetUtcNow()
        });
        await db.SaveChangesAsync();

        if (result.Status == "dry-run")
            logger?.LogInformation("WhatsApp dry-run ({Kind}) {UserId}: {Body}", kind, user.Id, content.PreviewText);
        else if (result.Status == "failed")
            logger?.LogWarning("WhatsApp gönderimi başarısız ({Kind}) {UserId}: {Error}", kind, user.Id, result.Error);
        return result;
    }
}
