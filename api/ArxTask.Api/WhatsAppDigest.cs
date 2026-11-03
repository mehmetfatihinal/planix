using System.Globalization;
using System.Text.RegularExpressions;

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
