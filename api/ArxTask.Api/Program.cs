using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Hangfire;
using Hangfire.Dashboard;
using Hangfire.Storage.SQLite;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using WebPush;

QuestPDF.Settings.License = LicenseType.Community;

var builder = WebApplication.CreateBuilder(args);

var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "ArXTask";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "ArXTask.Web";
// Production must supply its own signing secret via Jwt__Secret — the well-known
// development fallback would let anyone forge admin tokens on a live server.
var jwtSecret = builder.Configuration["Jwt:Secret"];
if (string.IsNullOrWhiteSpace(jwtSecret))
{
    if (builder.Environment.IsProduction())
    {
        throw new InvalidOperationException(
            "Jwt:Secret is not configured. Set the Jwt__Secret environment variable before starting the API in production.");
    }
    jwtSecret = "arx-task-local-development-secret-key-2026";
}
var allowedOrigins =
    builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? (builder.Configuration["Cors:AllowedOrigins"]?
        .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
    ?? ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001"];

builder.Services.AddDbContext<ArxTaskDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=arx-task.db"));
builder.Services.AddHttpClient();

// Hangfire — persistent delayed-job queue replaces the old polling
// TaskAlertDispatcher. SQLite storage keeps everything on-disk; jobs survive
// API restarts and Hangfire retries failed work automatically.
var hangfireConnectionString = builder.Configuration.GetConnectionString("Hangfire") ?? "hangfire.db";
builder.Services.AddHangfire(cfg => cfg
    .UseSimpleAssemblyNameTypeSerializer()
    .UseRecommendedSerializerSettings()
    .UseSQLiteStorage(hangfireConnectionString));
builder.Services.AddHangfireServer(opts =>
{
    opts.WorkerCount = 4;
    opts.Queues = new[] { "alerts", "default" };
});
builder.Services.AddScoped<INotificationDispatcher, NotificationDispatcher>();
builder.Services.AddScoped<IDigestService, DigestService>();
// Note: the old polling TaskAlertDispatcher BackgroundService is intentionally
// NOT registered anymore — Hangfire delayed jobs replace it.

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret))
        };
    });

builder.Services.AddAuthorization();
// İzin verilen ek origin son ekleri (Cors:AllowedOriginSuffixes). Varsayılan olarak
// Vercel ve Netlify dağıtımlarının tüm alt adresleri (production + preview) kabul edilir;
// böylece Vercel/Netlify URL'si değiştiğinde API'yi tekrar dağıtmaya gerek kalmaz.
var allowedOriginSuffixes =
    builder.Configuration.GetSection("Cors:AllowedOriginSuffixes").Get<string[]>()
    ?? builder.Configuration["Cors:AllowedOriginSuffixes"]?
        .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
    ?? [".vercel.app", ".netlify.app"];
builder.Services.AddCors(options =>
{
    options.AddPolicy("web", policy =>
        policy.SetIsOriginAllowed(origin =>
            {
                if (string.IsNullOrWhiteSpace(origin)) return false;
                if (allowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase)) return true;
                try
                {
                    var host = new Uri(origin).Host;
                    return allowedOriginSuffixes.Any(suffix =>
                        host.EndsWith(suffix, StringComparison.OrdinalIgnoreCase));
                }
                catch { return false; }
            })
            .AllowAnyHeader()
            .AllowAnyMethod());
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ArxTaskDbContext>();
    db.Database.EnsureCreated();
    EnsureSqliteSchema(db);
    NormalizeStoredData(db);
    SeedAdminUser(db, app.Configuration, app.Environment);
    ReenqueuePendingAlerts(db);
    ReenqueueHabits(db);

    // Gün sonu / hafta sonu özetleri: yalnızca geciken ve tekrarlayan işler (R8, R14).
    var recurringJobs = scope.ServiceProvider.GetRequiredService<IRecurringJobManager>();
    recurringJobs.AddOrUpdate<IDigestService>(
        "daily-digest",
        svc => svc.SendDailyDigestsAsync(),
        app.Configuration["Digest:DailyCron"] ?? "0 18 * * *",
        new RecurringJobOptions { TimeZone = AppTime.UserZone });
    recurringJobs.AddOrUpdate<IDigestService>(
        "weekly-digest",
        svc => svc.SendWeeklyDigestsAsync(),
        app.Configuration["Digest:WeeklyCron"] ?? "0 17 * * 5",
        new RecurringJobOptions { TimeZone = AppTime.UserZone });
}

app.UseCors("web");
app.UseAuthentication();
app.UseAuthorization();

// Hangfire dashboard at /hangfire — gated by JWT cookie. The cookie is set
// via POST /admin/hangfire-session (admin-only) which re-uses the bearer JWT.
app.UseHangfireDashboard("/hangfire", new DashboardOptions
{
    Authorization = new[] { new HangfireAdminAuthFilter(jwtIssuer, jwtAudience, jwtSecret) },
    IgnoreAntiforgeryToken = true
});

app.MapGet("/", () => Results.Ok(new { name = "ArX Task API", status = "ready" }));

app.MapPost("/auth/register", async (AuthRequest request, ArxTaskDbContext db) =>
{
    var email = NormalizeEmail(request.Email);
    if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 6)
    {
        return Results.BadRequest(new { message = "Email and password with at least 6 characters are required." });
    }

    if (await db.Users.AnyAsync(user => user.Email == email))
    {
        return Results.Conflict(new { message = "Email is already registered." });
    }

    var user = new AppUser
    {
        Id = NewId("user"),
        Email = email,
        Name = string.IsNullOrWhiteSpace(request.Name) ? email.Split('@')[0] : request.Name.Trim(),
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
        CreatedAt = DateTimeOffset.UtcNow
    };

    db.Users.Add(user);
    await db.SaveChangesAsync();

    return Results.Ok(AuthResponse.From(user, CreateToken(user)));
});

app.MapPost("/auth/login", async (AuthRequest request, ArxTaskDbContext db) =>
{
    var email = NormalizeEmail(request.Email);
    var user = await db.Users.FirstOrDefaultAsync(item => item.Email == email);
    if (user is null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
    {
        return Results.Unauthorized();
    }

    return Results.Ok(AuthResponse.From(user, CreateToken(user)));
});

app.MapGet("/auth/me", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    var user = await db.Users.FindAsync(userId);
    return user is null ? Results.Unauthorized() : Results.Ok(UserDto.From(user));
});

app.MapPost("/auth/refresh", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    var user = await db.Users.FindAsync(userId);
    return user is null ? Results.Unauthorized() : Results.Ok(AuthResponse.From(user, CreateToken(user)));
});

app.MapGet("/snapshot", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    return Results.Ok(await BuildSnapshot(db, userId));
});

app.MapGet("/companies", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await db.Companies.WhereUser(principal).OrderBy(item => item.Name).ToListAsync());
app.MapGet("/companies/duplicates", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
    Results.Ok(await BuildCompanyDuplicateReport(db, principal.UserId())));
app.MapPost("/companies", [Authorize] async (ClaimsPrincipal principal, CompanyEntity input, ArxTaskDbContext db, IConfiguration configuration, IHttpClientFactory httpClientFactory) =>
{
    input.Id = string.IsNullOrWhiteSpace(input.Id) ? NewId("company") : input.Id;
    input.UserId = principal.UserId();
    await GeocodeCompanyAsync(input, configuration, httpClientFactory);
    db.Companies.Add(input);
    await db.SaveChangesAsync();
    return Results.Ok(input);
});
app.MapPut("/companies/{id}", [Authorize] async (string id, ClaimsPrincipal principal, CompanyEntity input, ArxTaskDbContext db, IConfiguration configuration, IHttpClientFactory httpClientFactory) =>
    await UpdateCompany(id, principal, input, db, configuration, httpClientFactory));
// Adresi elle tetiklenen doğrulama — geocode sonucunu kaydeder ve döner.
app.MapPost("/companies/{id}/verify-address", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db, IConfiguration configuration, IHttpClientFactory httpClientFactory) =>
{
    var existing = await db.Companies.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (existing is null) return Results.NotFound();
    var verified = await GeocodeCompanyAsync(existing, configuration, httpClientFactory, force: true);
    existing.UpdatedAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(new { company = existing, verified });
});
// Koordinatı eksik tüm firmaları topluca geocode eder (geofencing kapsamını genişletir).
app.MapPost("/companies/geocode-missing", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db, IConfiguration configuration, IHttpClientFactory httpClientFactory) =>
{
    var userId = principal.UserId();
    var candidates = await db.Companies
        .Where(item => item.UserId == userId && item.Address != "" && item.Latitude == 0 && item.Longitude == 0)
        .Take(25)
        .ToListAsync();
    var updated = 0;
    foreach (var company in candidates)
    {
        if (await GeocodeCompanyAsync(company, configuration, httpClientFactory)) updated++;
    }
    await db.SaveChangesAsync();
    return Results.Ok(new { checkedCount = candidates.Count, verifiedCount = updated });
});
app.MapDelete("/companies/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await DeleteOwned(id, principal, db, db.Companies));
app.MapPost("/companies/{id}/archive", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var existing = await db.Companies.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (existing is null) return Results.NotFound();
    existing.ArchivedAt = DateTimeOffset.UtcNow.ToString("O");
    existing.UpdatedAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});
app.MapPost("/companies/{id}/unarchive", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var existing = await db.Companies.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (existing is null) return Results.NotFound();
    existing.ArchivedAt = null;
    existing.UpdatedAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

app.MapGet("/modules", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await db.Modules.WhereUser(principal).OrderBy(item => item.Name).ToListAsync());
app.MapPost("/modules", [Authorize] async (ClaimsPrincipal principal, WorkModuleEntity input, ArxTaskDbContext db) =>
    await CreateOwned(db, principal, input, db.Modules));
app.MapPut("/modules/{id}", [Authorize] async (string id, ClaimsPrincipal principal, WorkModuleEntity input, ArxTaskDbContext db) =>
    await UpdateModule(id, principal, input, db));
app.MapDelete("/modules/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await DeleteOwned(id, principal, db, db.Modules));

app.MapGet("/tasks", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await db.Tasks.WhereUser(principal).OrderBy(item => item.DueDate).ToListAsync());
app.MapPost("/tasks", [Authorize] async (
    ClaimsPrincipal principal,
    BusinessTaskEntity input,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory) =>
    await CreateTaskWithAutoCategory(principal, input, db, configuration, httpClientFactory));
app.MapPut("/tasks/{id}", [Authorize] async (string id, ClaimsPrincipal principal, BusinessTaskEntity input, ArxTaskDbContext db) =>
    await UpdateTask(id, principal, input, db));
app.MapDelete("/tasks/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await DeleteTask(id, principal, db));
app.MapPost("/tasks/{id}/request-completion", [Authorize] async (
    string id,
    ClaimsPrincipal principal,
    TaskCompletionRequest? request,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory) =>
    await RequestTaskCompletion(id, principal, request, db, configuration, httpClientFactory));

app.MapGet("/notes", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await db.Notes.WhereUser(principal).OrderByDescending(item => item.Id).ToListAsync());
app.MapPost("/notes", [Authorize] async (ClaimsPrincipal principal, NoteEntity input, ArxTaskDbContext db) =>
    await CreateOwned(db, principal, input, db.Notes));
app.MapPut("/notes/{id}", [Authorize] async (string id, ClaimsPrincipal principal, NoteEntity input, ArxTaskDbContext db) =>
    await UpdateNote(id, principal, input, db));
app.MapDelete("/notes/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await DeleteOwned(id, principal, db, db.Notes));

app.MapGet("/products", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await db.Products.WhereUser(principal).OrderBy(item => item.Category).ThenBy(item => item.Name).ToListAsync());
app.MapPost("/products", [Authorize] async (ClaimsPrincipal principal, ProductEntity input, ArxTaskDbContext db) =>
    await CreateOwned(db, principal, input, db.Products));
app.MapPut("/products/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ProductEntity input, ArxTaskDbContext db) =>
    await UpdateProduct(id, principal, input, db));
app.MapDelete("/products/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await DeleteOwned(id, principal, db, db.Products));

app.MapGet("/documents", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await db.Documents.WhereUser(principal).OrderByDescending(item => item.Id).ToListAsync());
app.MapPost("/documents", [Authorize] async (ClaimsPrincipal principal, DocumentEntity input, ArxTaskDbContext db) =>
    await CreateOwned(db, principal, input, db.Documents));
app.MapPut("/documents/{id}", [Authorize] async (string id, ClaimsPrincipal principal, DocumentEntity input, ArxTaskDbContext db) =>
    await UpdateDocument(id, principal, input, db));
app.MapDelete("/documents/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await DeleteOwned(id, principal, db, db.Documents));

app.MapGet("/reminders", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await db.Reminders.WhereUser(principal).OrderBy(item => item.StartTime).ToListAsync());
app.MapPost("/reminders", [Authorize] async (ClaimsPrincipal principal, ReminderEntity input, ArxTaskDbContext db) =>
    await CreateOwned(db, principal, input, db.Reminders));
app.MapPut("/reminders/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ReminderEntity input, ArxTaskDbContext db) =>
    await UpdateReminder(id, principal, input, db));
app.MapDelete("/reminders/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await DeleteOwned(id, principal, db, db.Reminders));

app.MapGet("/offers", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await db.Offers.Include(item => item.Items).Where(item => item.UserId == principal.UserId()).OrderByDescending(item => item.OfferDate).ToListAsync());
app.MapPost("/offers", [Authorize] async (ClaimsPrincipal principal, OfferEntity input, ArxTaskDbContext db) =>
    await CreateOffer(principal, input, db));
app.MapPut("/offers/{id}", [Authorize] async (string id, ClaimsPrincipal principal, OfferEntity input, ArxTaskDbContext db) =>
    await UpdateOffer(id, principal, input, db));
app.MapDelete("/offers/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await DeleteOffer(id, principal, db));
app.MapPost("/offers/{id}/send", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await SendOffer(id, principal, db));
app.MapPost("/offers/{id}/accept", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await AcceptOffer(id, principal, db));
app.MapPost("/offers/{id}/convert-to-invoice", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await ConvertOfferToInvoice(id, principal, db));

app.MapGet("/invoices", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await db.Invoices.Include(item => item.Items).Where(item => item.UserId == principal.UserId()).OrderByDescending(item => item.InvoiceDate).ToListAsync());
app.MapPost("/invoices", [Authorize] async (ClaimsPrincipal principal, InvoiceEntity input, ArxTaskDbContext db) =>
    await CreateInvoice(principal, input, db));
app.MapPut("/invoices/{id}", [Authorize] async (string id, ClaimsPrincipal principal, InvoiceEntity input, ArxTaskDbContext db) =>
    await UpdateInvoice(id, principal, input, db));
app.MapDelete("/invoices/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await DeleteInvoice(id, principal, db));
app.MapPost("/invoices/{id}/mark-paid", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await MarkInvoicePaid(id, principal, db));

app.MapGet("/timeline", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await db.Timeline.WhereUser(principal).OrderByDescending(item => item.Id).ToListAsync());
app.MapPost("/timeline", [Authorize] async (ClaimsPrincipal principal, TimelineEntryEntity input, ArxTaskDbContext db) =>
    await CreateOwned(db, principal, input, db.Timeline));

app.MapGet("/routes", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await db.Routes.Include(item => item.Stops).Where(item => item.UserId == principal.UserId()).OrderByDescending(item => item.Date).ToListAsync());
app.MapPost("/routes", [Authorize] async (ClaimsPrincipal principal, RouteEntity input, ArxTaskDbContext db) =>
    await CreateRoute(principal, input, db));

app.MapPost("/ai-capture/commit", [Authorize] async (ClaimsPrincipal principal, ParsedCommitRequest request, ArxTaskDbContext db, IConfiguration configuration, IHttpClientFactory httpClientFactory) =>
    await CommitParsedCapture(principal, request, db, configuration, httpClientFactory));
app.MapPost("/ai-capture/analyze-and-commit", [Authorize] async (
    ClaimsPrincipal principal,
    AiCaptureAnalyzeRequest request,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory) =>
    await AnalyzeAndCommitCapture(principal, request, db, configuration, httpClientFactory));

// Conversational assistant over the user's own business data (real OpenAI call, grounded
// on a server-built snapshot). Returns 503 when no OpenAI key is configured so the client
// can fall back to its offline keyword summary.
app.MapPost("/assistant/ask", [Authorize] async (
    ClaimsPrincipal principal,
    AssistantAskRequest request,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory) =>
    await AnswerAssistant(principal, request, db, configuration, httpClientFactory));

app.MapGet("/notifications/status", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db, IConfiguration configuration) =>
{
    var userId = principal.UserId();
    var activeCount = await db.PushSubscriptions.CountAsync(item => item.UserId == userId && item.DisabledAt == null);
    return Results.Ok(new
    {
        subscribed = activeCount > 0,
        subscriptionCount = activeCount,
        publicKey = configuration["WebPush:PublicKey"]
    });
});

app.MapPost("/notifications/subscribe", [Authorize] async (ClaimsPrincipal principal, PushSubscriptionRequest request, ArxTaskDbContext db) =>
    await SavePushSubscription(principal, request, db));
app.MapDelete("/notifications/subscribe", [Authorize] async (ClaimsPrincipal principal, [FromBody] PushSubscriptionDeleteRequest request, ArxTaskDbContext db) =>
    await RemovePushSubscription(principal, request, db));
app.MapGet("/notifications/mobile/status", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    var activeCount = await db.MobileDevices.CountAsync(item => item.UserId == userId && item.DisabledAt == null);
    return Results.Ok(new
    {
        subscribed = activeCount > 0,
        deviceCount = activeCount
    });
});
app.MapPost("/notifications/mobile/register", [Authorize] async (ClaimsPrincipal principal, MobileDeviceRequest request, ArxTaskDbContext db) =>
    await SaveMobileDevice(principal, request, db));
app.MapDelete("/notifications/mobile/register", [Authorize] async (ClaimsPrincipal principal, [FromBody] MobileDeviceDeleteRequest request, ArxTaskDbContext db) =>
    await RemoveMobileDevice(principal, request, db));
app.MapPost("/notifications/action", async (
    NotificationActionRequest request,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory) =>
    await ApplyNotificationAction(request, db, configuration, httpClientFactory));

// --- Admin endpoints ----------------------------------------------------------

app.MapGet("/admin/users", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    if (!principal.IsAdmin()) return Results.Forbid();
    var users = await db.Users.OrderBy(item => item.Name).ToListAsync();
    var counts = await db.Tasks
        .GroupBy(item => new { item.UserId, item.Status })
        .Select(group => new { group.Key.UserId, group.Key.Status, Count = group.Count() })
        .ToListAsync();
    var grouped = counts
        .GroupBy(item => item.UserId)
        .ToDictionary(group => group.Key, group => group.ToDictionary(item => item.Status, item => item.Count));
    return Results.Ok(users.Select(user => new
    {
        id = user.Id,
        email = user.Email,
        name = user.Name,
        isAdmin = user.IsAdmin,
        isSystemAdmin = user.IsSystemAdmin,
        createdAt = user.CreatedAt.ToString("O"),
        taskCounts = new
        {
            open = grouped.TryGetValue(user.Id, out var byStatus) && byStatus.TryGetValue("open", out var openCount) ? openCount : 0,
            pending = byStatus is not null && byStatus.TryGetValue("pending_approval", out var pendingCount) ? pendingCount : 0,
            done = byStatus is not null && byStatus.TryGetValue("done", out var doneCount) ? doneCount : 0,
            snoozed = byStatus is not null && byStatus.TryGetValue("snoozed", out var snoozedCount) ? snoozedCount : 0
        }
    }));
});

app.MapGet("/admin/users/{userId}/tasks", [Authorize] async (
    string userId,
    string? status,
    string? companyId,
    ClaimsPrincipal principal,
    ArxTaskDbContext db) =>
{
    if (!principal.IsAdmin()) return Results.Forbid();
    var query = db.Tasks.Where(item => item.UserId == userId);
    if (!string.IsNullOrWhiteSpace(status)) query = query.Where(item => item.Status == status);
    if (!string.IsNullOrWhiteSpace(companyId)) query = query.Where(item => item.CompanyId == companyId);
    // SQLite cannot ORDER BY on DateTimeOffset — materialise first, sort in-memory.
    var tasks = (await query.ToListAsync())
        .OrderByDescending(item => item.CreatedAt)
        .ToList();
    return Results.Ok(tasks);
});

app.MapGet("/admin/tasks", [Authorize] async (
    string? userId,
    string? status,
    string? companyId,
    ClaimsPrincipal principal,
    ArxTaskDbContext db) =>
{
    if (!principal.IsAdmin()) return Results.Forbid();
    var query = db.Tasks.AsQueryable();
    if (!string.IsNullOrWhiteSpace(userId)) query = query.Where(item => item.UserId == userId);
    if (!string.IsNullOrWhiteSpace(status)) query = query.Where(item => item.Status == status);
    if (!string.IsNullOrWhiteSpace(companyId)) query = query.Where(item => item.CompanyId == companyId);
    var tasks = (await query.ToListAsync())
        .OrderByDescending(item => item.CreatedAt)
        .Take(500)
        .ToList();
    return Results.Ok(await JoinAdminTaskMetadata(db, tasks));
});

app.MapGet("/admin/tasks/pending", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    if (!principal.IsAdmin()) return Results.Forbid();
    var tasks = (await db.Tasks.Where(item => item.Status == "pending_approval").ToListAsync())
        .OrderByDescending(item => item.CompletionRequestedAt ?? "")
        .ToList();
    return Results.Ok(await JoinAdminTaskMetadata(db, tasks));
});

app.MapGet("/admin/companies", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    if (!principal.IsAdmin()) return Results.Forbid();
    var companies = await db.Companies.OrderBy(item => item.Name).ToListAsync();
    return Results.Ok(companies.Select(item => new { id = item.Id, name = item.Name, address = item.Address, userId = item.UserId }));
});

app.MapPost("/admin/tasks/{userId}/{taskId}/approve", [Authorize] async (
    string userId,
    string taskId,
    ClaimsPrincipal principal,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory) =>
{
    if (!principal.IsAdmin()) return Results.Forbid();
    var task = await db.Tasks.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == taskId);
    if (task is null) return Results.NotFound();

    task.Status = "done";
    task.CompletedAt = DateTimeOffset.UtcNow.ToString("O");
    task.CompletionRequestedAt = null;
    task.CompletionRequestedNote = null;
    task.LastRejectedAt = null;
    task.LastRejectionReason = null;

    var reminder = await db.Reminders.FirstOrDefaultAsync(item => item.UserId == userId && item.TaskId == task.Id);
    await SyncTaskAlertsForTask(db, userId, task, reminder);

    if (!string.IsNullOrWhiteSpace(task.CompanyId))
    {
        db.Timeline.Add(Timeline(userId, task.CompanyId!, "approval", "Görev onaylandı", task.Title, task.Id));
    }
    await db.SaveChangesAsync();

    var payload = new PushPayload(
        Title: "Göreviniz onaylandı",
        Body: task.Title,
        Url: "/today",
        TaskId: task.Id,
        CategoryId: "approval-result");
    await PushDispatcher.DispatchPushNow(db, httpClientFactory, configuration, new[] { userId }, payload);

    return Results.Ok(task);
});

app.MapPost("/admin/tasks/{userId}/{taskId}/reject", [Authorize] async (
    string userId,
    string taskId,
    TaskRejectRequest? request,
    ClaimsPrincipal principal,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory) =>
{
    if (!principal.IsAdmin()) return Results.Forbid();
    var task = await db.Tasks.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == taskId);
    if (task is null) return Results.NotFound();

    var reason = request?.Reason?.Trim();
    if (string.IsNullOrWhiteSpace(reason)) reason = null;

    task.Status = "open";
    task.CompletionRequestedAt = null;
    task.CompletionRequestedNote = null;
    task.LastRejectedAt = DateTimeOffset.UtcNow.ToString("O");
    task.LastRejectionReason = reason;

    if (!string.IsNullOrWhiteSpace(task.CompanyId))
    {
        db.Timeline.Add(Timeline(userId, task.CompanyId!, "approval-rejected", "Görev reddedildi", reason ?? "Sebep belirtilmedi", task.Id));
    }
    await db.SaveChangesAsync();

    var payload = new PushPayload(
        Title: "Göreviniz reddedildi",
        Body: reason is null ? task.Title : $"{task.Title} — {Truncate(reason, 100)}",
        Url: "/today",
        TaskId: task.Id,
        CategoryId: "approval-result",
        ExtraData: new Dictionary<string, object?> { ["reason"] = reason ?? "" });
    await PushDispatcher.DispatchPushNow(db, httpClientFactory, configuration, new[] { userId }, payload);

    return Results.Ok(task);
});

app.MapPost("/admin/users/{id}/promote", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    if (!principal.IsAdmin()) return Results.Forbid();
    var user = await db.Users.FindAsync(id);
    if (user is null) return Results.NotFound();
    user.IsAdmin = true;
    await db.SaveChangesAsync();
    return Results.Ok(UserDto.From(user));
});

app.MapPost("/admin/users/{id}/demote", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    if (!principal.IsAdmin()) return Results.Forbid();
    var user = await db.Users.FindAsync(id);
    if (user is null) return Results.NotFound();
    if (user.IsSystemAdmin)
    {
        return Results.BadRequest(new { message = "Sistem yöneticisi geri alınamaz." });
    }
    if (user.Id == principal.UserId())
    {
        return Results.BadRequest(new { message = "Kendi yöneticilik yetkinizi kaldıramazsınız." });
    }
    var adminCount = await db.Users.CountAsync(item => item.IsAdmin);
    if (user.IsAdmin && adminCount <= 1)
    {
        return Results.BadRequest(new { message = "En az bir yönetici kalmalı." });
    }
    user.IsAdmin = false;
    await db.SaveChangesAsync();
    return Results.Ok(UserDto.From(user));
});

// Sets a HttpOnly cookie carrying the caller's JWT so the Hangfire dashboard
// (a separate non-API surface) can authorize the same admin in the browser.
// Frontend calls this just before opening /hangfire in a new tab.
app.MapPost("/admin/hangfire-session", [Authorize] (HttpContext ctx, ClaimsPrincipal principal) =>
{
    if (!principal.IsAdmin()) return Results.Forbid();
    var authHeader = ctx.Request.Headers.Authorization.ToString();
    string? rawToken = null;
    if (authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
    {
        rawToken = authHeader[7..].Trim();
    }
    if (string.IsNullOrWhiteSpace(rawToken))
    {
        return Results.BadRequest(new { message = "Bearer token required in Authorization header." });
    }
    var isHttps = ctx.Request.IsHttps;
    ctx.Response.Cookies.Append("hangfire-token", rawToken, new CookieOptions
    {
        HttpOnly = true,
        Secure = isHttps,
        SameSite = SameSiteMode.Lax,
        Expires = DateTimeOffset.UtcNow.AddHours(1),
        Path = "/hangfire"
    });
    return Results.Ok(new { ok = true, expiresInSeconds = 3600 });
});

// One-shot VAPID key generator (admin-only). Returns a fresh public/private
// key pair the operator can paste into `dotnet user-secrets set` or environment
// variables. Generating once does NOT change the running app's config — the
// operator must wire the values through configuration manually.
app.MapPost("/admin/web-push/keys", [Authorize] (ClaimsPrincipal principal, IConfiguration configuration) =>
{
    if (!principal.IsAdmin()) return Results.Forbid();
    var keys = VapidHelper.GenerateVapidKeys();
    var currentlyConfigured = !string.IsNullOrWhiteSpace(configuration["WebPush:PublicKey"]) &&
                              !string.IsNullOrWhiteSpace(configuration["WebPush:PrivateKey"]);
    var setCommands = new[]
    {
        $"dotnet user-secrets set \"WebPush:PublicKey\" \"{keys.PublicKey}\"",
        $"dotnet user-secrets set \"WebPush:PrivateKey\" \"{keys.PrivateKey}\"",
        "dotnet user-secrets set \"WebPush:Subject\" \"mailto:info@menupanels.com\""
    };
    return Results.Ok(new
    {
        publicKey = keys.PublicKey,
        privateKey = keys.PrivateKey,
        subject = "mailto:info@menupanels.com",
        currentlyConfigured,
        instructions = new
        {
            dev = "Run these commands in api/ArxTask.Api directory:",
            commands = setCommands,
            production = "On Plesk/server, set environment variables: WebPush__PublicKey, WebPush__PrivateKey, WebPush__Subject (note the double underscores)."
        }
    });
});

// --- Kullanıcı ayarları (satıcı profili, bildirim süresi, ev konumu) ---------

app.MapGet("/settings", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var user = await db.Users.FindAsync(principal.UserId());
    return user is null ? Results.Unauthorized() : Results.Ok(UserSettingsDto.From(user));
});

app.MapPut("/settings", [Authorize] async (ClaimsPrincipal principal, UserSettingsRequest request, ArxTaskDbContext db) =>
{
    var user = await db.Users.FindAsync(principal.UserId());
    if (user is null) return Results.Unauthorized();
    if (request.Name is not null && !string.IsNullOrWhiteSpace(request.Name)) user.Name = request.Name.Trim();
    if (request.CompanyName is not null) user.CompanyName = request.CompanyName.Trim();
    if (request.CompanyAddress is not null) user.CompanyAddress = request.CompanyAddress.Trim();
    if (request.CompanyPhone is not null) user.CompanyPhone = request.CompanyPhone.Trim();
    if (request.CompanyEmail is not null) user.CompanyEmail = request.CompanyEmail.Trim();
    if (request.CompanyTaxId is not null) user.CompanyTaxId = request.CompanyTaxId.Trim();
    if (request.CompanyIban is not null) user.CompanyIban = request.CompanyIban.Trim();
    if (request.PaymentTerms is not null) user.PaymentTerms = request.PaymentTerms.Trim();
    if (request.DefaultReminderLeadMinutes is not null) user.DefaultReminderLeadMinutes = Math.Clamp(request.DefaultReminderLeadMinutes.Value, 0, 60 * 24 * 7);
    if (request.HomeLatitude is not null) user.HomeLatitude = request.HomeLatitude.Value;
    if (request.HomeLongitude is not null) user.HomeLongitude = request.HomeLongitude.Value;
    if (request.HomeAddress is not null) user.HomeAddress = request.HomeAddress.Trim();
    if (request.DailyDigestEnabled is not null) user.DailyDigestEnabled = request.DailyDigestEnabled.Value;
    if (request.WeeklyDigestEnabled is not null) user.WeeklyDigestEnabled = request.WeeklyDigestEnabled.Value;
    await db.SaveChangesAsync();
    return Results.Ok(UserSettingsDto.From(user));
});

// --- Gerçek PDF üretimi (teklif + fatura) ------------------------------------

app.MapGet("/offers/{id}/pdf", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    var offer = await db.Offers.Include(item => item.Items).FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (offer is null) return Results.NotFound();
    var company = string.IsNullOrWhiteSpace(offer.CompanyId)
        ? null
        : await db.Companies.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == offer.CompanyId);
    var seller = await db.Users.FindAsync(userId);
    var bytes = BuildSalesDocumentPdf(
        title: "TEKLİF / ANGEBOT",
        documentNumber: offer.OfferNumber,
        documentDate: offer.OfferDate,
        secondaryLine: $"Geçerlilik: {offer.ValidityDays} gün",
        company: company,
        seller: seller,
        items: offer.Items.Select(item => (item.ProductName, item.Description, item.Quantity, item.UnitPrice, item.TotalPrice)).ToList(),
        subtotal: offer.Subtotal,
        vatRate: offer.VatRate,
        total: offer.Total,
        currency: offer.Currency,
        notes: offer.Notes);
    offer.PdfUrl = $"/offers/{offer.Id}/pdf";
    await db.SaveChangesAsync();
    return Results.File(bytes, "application/pdf", $"{SanitizeFileName(offer.OfferNumber)}.pdf");
});

app.MapGet("/invoices/{id}/pdf", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    var invoice = await db.Invoices.Include(item => item.Items).FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (invoice is null) return Results.NotFound();
    var company = string.IsNullOrWhiteSpace(invoice.CompanyId)
        ? null
        : await db.Companies.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == invoice.CompanyId);
    var seller = await db.Users.FindAsync(userId);
    var bytes = BuildSalesDocumentPdf(
        title: "FATURA / RECHNUNG",
        documentNumber: invoice.InvoiceNumber,
        documentDate: invoice.InvoiceDate,
        secondaryLine: $"Son ödeme: {invoice.DueDate}",
        company: company,
        seller: seller,
        items: invoice.Items.Select(item => (item.ProductName, item.Description, item.Quantity, item.UnitPrice, item.TotalPrice)).ToList(),
        subtotal: invoice.Subtotal,
        vatRate: invoice.VatRate,
        total: invoice.Total,
        currency: "EUR",
        notes: string.IsNullOrWhiteSpace(seller?.PaymentTerms) ? "" : seller!.PaymentTerms);
    return Results.File(bytes, "application/pdf", $"{SanitizeFileName(invoice.InvoiceNumber)}.pdf");
});

// --- Dosya yükleme / servis (görev fotoğrafları + belge taramaları) ----------

app.MapPost("/files", [Authorize] async (
    IFormFile file,
    [FromForm] string? kind,
    [FromForm] string? relatedId,
    ClaimsPrincipal principal,
    ArxTaskDbContext db,
    IWebHostEnvironment environment) =>
{
    var saved = await SaveUploadedFileAsync(file, kind, relatedId, principal.UserId(), db, environment);
    return saved.Error is not null
        ? Results.BadRequest(new { message = saved.Error })
        : Results.Ok(new { id = saved.File!.Id, fileName = saved.File.FileName, size = saved.File.Size, url = $"/files/{saved.File.Id}" });
}).DisableAntiforgery();

app.MapGet("/files/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    // Yöneticiler onay ekranındaki fotoğrafları görmek için başka kullanıcıların dosyalarına erişebilir.
    var file = principal.IsAdmin()
        ? await db.StoredFiles.FirstOrDefaultAsync(item => item.Id == id)
        : await db.StoredFiles.FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (file is null || !File.Exists(file.StoragePath)) return Results.NotFound();
    return Results.File(file.StoragePath, file.ContentType, file.FileName);
});

// --- Görev atama + kabul + erteleme (R17, R14) -------------------------------

app.MapPost("/admin/tasks/assign", [Authorize] async (
    AssignTaskRequest request,
    ClaimsPrincipal principal,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory) =>
{
    if (!principal.IsAdmin()) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(request.TargetUserId) || string.IsNullOrWhiteSpace(request.Title))
    {
        return Results.BadRequest(new { message = "Hedef kullanıcı ve görev başlığı zorunludur." });
    }
    var target = await db.Users.FindAsync(request.TargetUserId);
    if (target is null) return Results.NotFound(new { message = "Kullanıcı bulunamadı." });

    var task = new BusinessTaskEntity
    {
        Id = NewId("task"),
        UserId = target.Id,
        CompanyId = string.IsNullOrWhiteSpace(request.CompanyId) ? null : request.CompanyId,
        Title = request.Title.Trim(),
        Description = request.Description?.Trim() ?? "",
        Type = ExistingModuleType(request.Type),
        ModuleIds = request.ModuleIds ?? "",
        DueDate = NormalizeDate(request.DueDate),
        DueTime = NormalizeTime(request.DueTime),
        Priority = NormalizePriority(request.Priority),
        Status = "open",
        NotificationsEnabled = true,
        AssignedByUserId = principal.UserId(),
        RequirePhotoProof = request.RequirePhotoProof ?? true,
        CreatedAt = DateTimeOffset.UtcNow
    };
    await ApplyAutoCategory(db, target.Id, task, configuration, httpClientFactory);
    db.Tasks.Add(task);
    await EnsureDefaultLeadReminder(db, target, task);
    await SyncTaskAlertsForTask(db, target.Id, task, await db.Reminders.FirstOrDefaultAsync(item => item.UserId == target.Id && item.TaskId == task.Id));
    if (!string.IsNullOrWhiteSpace(task.CompanyId))
    {
        db.Timeline.Add(Timeline(target.Id, task.CompanyId!, "assignment", "Görev atandı", task.Title, task.Id));
    }
    await db.SaveChangesAsync();

    var assigner = await db.Users.FindAsync(principal.UserId());
    await PushDispatcher.DispatchPushNow(db, httpClientFactory, configuration, new[] { target.Id }, new PushPayload(
        Title: "Yeni görev atandı",
        Body: $"{assigner?.Name ?? "Yönetici"} → {task.Title}",
        Url: "/today",
        TaskId: task.Id,
        CategoryId: "task-assigned"));
    return Results.Ok(task);
});

// Çalışan atanan görevi görüp kabul eder; atayan yönetici bilgilendirilir.
app.MapPost("/tasks/{id}/acknowledge", [Authorize] async (
    string id,
    ClaimsPrincipal principal,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory) =>
{
    var userId = principal.UserId();
    var task = await db.Tasks.FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (task is null) return Results.NotFound();
    if (task.AcknowledgedAt is not null) return Results.Ok(task);
    task.AcknowledgedAt = DateTimeOffset.UtcNow.ToString("O");
    if (!string.IsNullOrWhiteSpace(task.CompanyId))
    {
        db.Timeline.Add(Timeline(userId, task.CompanyId!, "assignment", "Görev kabul edildi", task.Title, task.Id));
    }
    await db.SaveChangesAsync();
    if (!string.IsNullOrWhiteSpace(task.AssignedByUserId))
    {
        var worker = await db.Users.FindAsync(userId);
        await PushDispatcher.DispatchPushNow(db, httpClientFactory, configuration, new[] { task.AssignedByUserId! }, new PushPayload(
            Title: "Görev kabul edildi",
            Body: $"{worker?.Name ?? "Çalışan"} → {task.Title}",
            Url: "/admin",
            TaskId: task.Id,
            CategoryId: "task-acknowledged"));
    }
    return Results.Ok(task);
});

// Görevi ertele + gecikme nedenini kaydet (günlük/haftalık raporlarda kullanılır).
app.MapPost("/tasks/{id}/snooze", [Authorize] async (string id, TaskSnoozeRequest? request, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    var task = await db.Tasks.FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (task is null) return Results.NotFound();

    if (!string.IsNullOrWhiteSpace(request?.UntilDate))
    {
        task.DueDate = NormalizeDate(request.UntilDate) ?? task.DueDate;
        task.DueTime = NormalizeTime(request.UntilTime) ?? task.DueTime;
        task.Status = "snoozed";
    }
    else if (!TryShiftTaskDueTime(task, Math.Clamp(request?.Hours ?? 1, 1, 24 * 14)))
    {
        return Results.BadRequest(new { message = "Görevin vade tarihi/saati olmadığı için ertelenemedi." });
    }
    else
    {
        task.Status = "snoozed";
    }

    var reason = request?.Reason?.Trim();
    if (!string.IsNullOrWhiteSpace(reason))
    {
        task.DelayReason = reason;
        if (!string.IsNullOrWhiteSpace(task.CompanyId))
        {
            db.Timeline.Add(Timeline(userId, task.CompanyId!, "delay", "Görev ertelendi", reason, task.Id));
        }
    }
    var reminder = await db.Reminders.FirstOrDefaultAsync(item => item.UserId == userId && item.TaskId == task.Id);
    await SyncTaskAlertsForTask(db, userId, task, reminder);
    await db.SaveChangesAsync();
    return Results.Ok(task);
});

// --- Alışkanlık hedefleri (habit) ---------------------------------------------

// "Tarih belirle": alışkanlığı planning'den active'e alır, günlük hatırlatmayı kurar.
app.MapPost("/tasks/{id}/habit-start", [Authorize] async (string id, HabitStartRequest request, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    var habit = await db.Tasks.FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (habit is null || !habit.IsHabit) return Results.NotFound();
    var start = NormalizeDate(request.StartDate);
    if (start is null) return Results.BadRequest(new { message = "Geçerli bir başlama tarihi girin (yyyy-MM-dd)." });

    habit.HabitStage = "active";
    habit.HabitStartDate = start;
    habit.DueDate = start;
    habit.DueTime = NormalizeTime(request.ReminderTime) ?? "20:00";
    habit.HabitReminderTime = habit.DueTime;
    if (request.IntervalDays is > 0) habit.NudgeIntervalDays = request.IntervalDays.Value;
    // Dürtme döngüsünü durdur, günlük alışkanlık hatırlatmasını kur.
    if (!string.IsNullOrWhiteSpace(habit.HabitNudgeJobId))
    {
        try { BackgroundJob.Delete(habit.HabitNudgeJobId); } catch { }
        habit.HabitNudgeJobId = null;
    }
    habit.NextNudgeAt = null;
    HabitScheduler.ScheduleDailyReminder(habit);
    await db.SaveChangesAsync();
    return Results.Ok(habit);
});

// "Sonra hatırlat": dürtmeyi birkaç gün ertele (uygulama içinden).
app.MapPost("/tasks/{id}/habit-snooze", [Authorize] async (string id, HabitSnoozeRequest? request, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    var habit = await db.Tasks.FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (habit is null || !habit.IsHabit) return Results.NotFound();
    var days = Math.Clamp(request?.Days ?? habit.NudgeIntervalDays, 1, 60);
    HabitScheduler.ScheduleNudge(habit, TimeSpan.FromDays(days));
    await db.SaveChangesAsync();
    return Results.Ok(new { ok = true, nextNudgeAt = habit.NextNudgeAt });
});

// Alışkanlığı tamamen durdur (dürtme + günlük hatırlatma işlerini kaldır).
app.MapPost("/tasks/{id}/habit-stop", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    var habit = await db.Tasks.FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (habit is null || !habit.IsHabit) return Results.NotFound();
    HabitScheduler.RemoveJobs(habit);
    habit.HabitStage = "stopped";
    habit.NextNudgeAt = null;
    await db.SaveChangesAsync();
    return Results.Ok(habit);
});

// --- Alışveriş listesi (R11) --------------------------------------------------

app.MapGet("/shopping-items", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await db.ShoppingItems.WhereUser(principal).OrderBy(item => item.Status).ThenByDescending(item => item.CreatedAt).ToListAsync());
app.MapPost("/shopping-items", [Authorize] async (ClaimsPrincipal principal, ShoppingItemEntity input, ArxTaskDbContext db) =>
    await CreateOwned(db, principal, input, db.ShoppingItems));
app.MapPut("/shopping-items/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ShoppingItemEntity input, ArxTaskDbContext db) =>
{
    var existing = await db.ShoppingItems.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (existing is null) return Results.NotFound();
    existing.Name = input.Name;
    existing.Category = input.Category;
    existing.Chain = input.Chain;
    if (!string.Equals(existing.Status, input.Status, StringComparison.OrdinalIgnoreCase))
    {
        existing.Status = input.Status;
        existing.CompletedAt = string.Equals(input.Status, "done", StringComparison.OrdinalIgnoreCase)
            ? DateTimeOffset.UtcNow.ToString("O")
            : null;
    }
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});
app.MapDelete("/shopping-items/{id}", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    await DeleteOwned(id, principal, db, db.ShoppingItems));

// Açık alışveriş maddelerini satan aday noktalar: kullanıcının koordinatlı firmaları
// ad/etiket eşleşmesiyle taranır; mobil taraf bunları geofence olarak kurar.
app.MapGet("/shopping-items/sellers", [Authorize] async (ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    var openItems = await db.ShoppingItems
        .Where(item => item.UserId == userId && item.Status == "open")
        .ToListAsync();
    if (openItems.Count == 0) return Results.Ok(Array.Empty<object>());
    var companies = await db.Companies
        .Where(item => item.UserId == userId && item.Latitude != 0 && item.Longitude != 0)
        .ToListAsync();
    var matches = new List<object>();
    foreach (var item in openItems)
    {
        var needle = NormalizeCompanyFold(item.Name);
        var categoryNeedle = NormalizeCompanyFold(item.Category);
        foreach (var company in companies)
        {
            var haystack = NormalizeCompanyFold($"{company.Name} {company.Tags}");
            var matchesName = !string.IsNullOrWhiteSpace(needle) && haystack.Contains(needle, StringComparison.Ordinal);
            var matchesCategory = !string.IsNullOrWhiteSpace(categoryNeedle) && haystack.Contains(categoryNeedle, StringComparison.Ordinal);
            if (matchesName || matchesCategory)
            {
                matches.Add(new
                {
                    itemId = item.Id,
                    itemName = item.Name,
                    companyId = company.Id,
                    companyName = company.Name,
                    latitude = company.Latitude,
                    longitude = company.Longitude,
                    address = company.Address
                });
            }
        }
    }
    return Results.Ok(matches);
});

// Rota koridoru üzerinde alışveriş fırsatı: verilen rota noktalarının yol koridorunda,
// kullanıcının açık alışveriş maddelerine uyan işletmeleri (OpenStreetMap/Overpass) bulur.
// Hem yola çıkmadan önce özet hem de seyir halinde geofence için kullanılır.
app.MapPost("/route/errand-stops", [Authorize] async (
    RouteErrandRequest request,
    ClaimsPrincipal principal,
    ArxTaskDbContext db,
    IHttpClientFactory httpClientFactory) =>
{
    var userId = principal.UserId();
    if (request.Coords is null || request.Coords.Count < 1)
    {
        return Results.BadRequest(new { message = "Rota noktaları gerekli." });
    }

    var openItems = await db.ShoppingItems.Where(item => item.UserId == userId && item.Status == "open").ToListAsync();
    if (openItems.Count == 0)
    {
        return Results.Ok(new { matches = Array.Empty<object>(), note = "Açık alışveriş maddesi yok." });
    }

    // Rota noktalarını doğrula (lat,lng çiftleri).
    var routePoints = request.Coords
        .Where(c => c is { Count: >= 2 } && Math.Abs(c[0]) <= 90 && Math.Abs(c[1]) <= 180)
        .Select(c => (Lat: c[0], Lng: c[1]))
        .ToList();
    if (routePoints.Count == 0)
    {
        return Results.BadRequest(new { message = "Geçerli rota noktası yok." });
    }

    var client = httpClientFactory.CreateClient();
    client.Timeout = TimeSpan.FromSeconds(20);

    // 1) Yol koridorunu al: OSRM ile gerçek yol geometrisi; başarısızsa düz çizgi noktaları.
    var corridor = await GetRouteCorridor(client, routePoints);

    // 2) Koridor boyunca ~1.5km aralıkla örnek noktalar (Overpass yükünü sınırla).
    var sampled = SampleCorridorPoints(corridor, spacingMeters: 1500, maxPoints: 18);

    // 3) Açık maddelerin kategori/zincirlerinden Overpass sorgusu kur ve çalıştır.
    var pois = await QueryOverpassAlongCorridor(client, sampled, openItems, request.BufferMeters ?? 700);

    // 4) Her POI'yi karşıladığı maddeyle eşle, rotaya en yakın mesafeye göre sırala.
    var matches = MatchPoisToItems(pois, openItems, corridor)
        .OrderBy(m => m.DistanceToRouteMeters)
        .Take(40)
        .ToList();

    return Results.Ok(new
    {
        matches = matches.Select(m => new
        {
            itemId = m.ItemId,
            itemName = m.ItemName,
            shopName = m.ShopName,
            category = m.Category,
            chain = m.Chain,
            latitude = m.Lat,
            longitude = m.Lng,
            distanceToRouteMeters = (int)m.DistanceToRouteMeters
        })
    });
});

// --- Ziyaret geçmişi + rota yaşam döngüsü (R12) ------------------------------

app.MapGet("/visits", [Authorize] async (string? from, string? to, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var visits = await db.CompanyVisits.WhereUser(principal).ToListAsync();
    if (DateOnly.TryParse(from, out var fromDate))
    {
        visits = visits.Where(item => AppTime.UserToday(item.VisitedAt) >= fromDate).ToList();
    }
    if (DateOnly.TryParse(to, out var toDate))
    {
        visits = visits.Where(item => AppTime.UserToday(item.VisitedAt) <= toDate).ToList();
    }
    return Results.Ok(visits.OrderByDescending(item => item.VisitedAt).Take(500).ToList());
});
app.MapPost("/visits", [Authorize] async (ClaimsPrincipal principal, CompanyVisitEntity input, ArxTaskDbContext db) =>
    await CreateOwned(db, principal, input, db.CompanyVisits));

app.MapPost("/routes/{id}/start", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var route = await db.Routes.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (route is null) return Results.NotFound();
    route.Status = "active";
    route.StartedAt ??= DateTimeOffset.UtcNow.ToString("O");
    await db.SaveChangesAsync();
    return Results.Ok(route);
});
app.MapPost("/routes/{id}/complete", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var route = await db.Routes.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (route is null) return Results.NotFound();
    route.Status = "completed";
    route.CompletedAt = DateTimeOffset.UtcNow.ToString("O");
    await db.SaveChangesAsync();
    return Results.Ok(route);
});
// Rota durağına varıldığında ziyaret kaydı düşer — haftalık analiz bu veriden beslenir.
app.MapPost("/routes/{id}/stops/{stopId}/visited", [Authorize] async (string id, string stopId, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    var stop = await db.RouteStops.FirstOrDefaultAsync(item => item.UserId == userId && item.RouteId == id && item.Id == stopId);
    if (stop is null) return Results.NotFound();
    stop.VisitedAt = DateTimeOffset.UtcNow.ToString("O");
    db.CompanyVisits.Add(new CompanyVisitEntity
    {
        Id = NewId("visit"),
        UserId = userId,
        CompanyId = stop.CompanyId,
        RouteId = id,
        Source = "route",
        VisitedAt = DateTimeOffset.UtcNow
    });
    await db.SaveChangesAsync();
    return Results.Ok(stop);
});

// --- Raporlar (R8, R12, R14) --------------------------------------------------

app.MapGet("/reports", [Authorize] async (string? kind, int? limit, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var query = db.Reports.WhereUser(principal);
    if (!string.IsNullOrWhiteSpace(kind)) query = query.Where(item => item.Kind == kind);
    var reports = (await query.ToListAsync())
        .OrderByDescending(item => item.Date)
        .Take(Math.Clamp(limit ?? 30, 1, 100))
        .Select(item => new { item.Id, item.Kind, item.Date, payload = TryParseJson(item.Payload), item.CreatedAt })
        .ToList();
    return Results.Ok(reports);
});

// Haftalık analiz — canlı hesaplanır: rotalar, ziyaretler, görev/teklif/fatura özetleri.
app.MapGet("/reports/weekly-analysis", [Authorize] async (string? weekStart, ClaimsPrincipal principal, ArxTaskDbContext db) =>
    Results.Ok(await BuildWeeklyAnalysis(db, principal.UserId(), weekStart)));

// --- Linkten teklif oluşturma (R7) --------------------------------------------

app.MapPost("/offers/from-url", [Authorize] async (
    OfferFromUrlRequest request,
    ClaimsPrincipal principal,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory) =>
{
    if (string.IsNullOrWhiteSpace(request.Url) || !Uri.TryCreate(request.Url.Trim(), UriKind.Absolute, out var uri)
        || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
    {
        return Results.BadRequest(new { message = "Geçerli bir http(s) adresi girin." });
    }
    if (IsPrivateHost(uri))
    {
        return Results.BadRequest(new { message = "Bu adres taranamaz." });
    }

    string html;
    try
    {
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(12);
        using var pageRequest = new HttpRequestMessage(HttpMethod.Get, uri);
        pageRequest.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (compatible; ArxTaskBot/1.0)");
        pageRequest.Headers.TryAddWithoutValidation("Accept", "text/html,application/xhtml+xml");
        using var response = await client.SendAsync(pageRequest, HttpCompletionOption.ResponseHeadersRead);
        if (!response.IsSuccessStatusCode)
        {
            return Results.Problem($"Sayfa alınamadı (HTTP {(int)response.StatusCode}).", statusCode: StatusCodes.Status502BadGateway);
        }
        html = await ReadBoundedStringAsync(response, maxBytes: 2_000_000);
    }
    catch (Exception)
    {
        return Results.Problem("Sayfa indirilemedi — adresi kontrol edin.", statusCode: StatusCodes.Status502BadGateway);
    }

    var scraped = ExtractProductsFromHtml(html, uri);
    if (scraped.Count == 0)
    {
        var apiKey = configuration["OpenAI:ApiKey"];
        if (!string.IsNullOrWhiteSpace(apiKey))
        {
            scraped = await ExtractProductsWithOpenAi(html, uri, configuration, httpClientFactory, apiKey!);
        }
    }
    if (scraped.Count == 0)
    {
        return Results.UnprocessableEntity(new { message = "Sayfadan ürün/fiyat bilgisi çıkarılamadı." });
    }

    var userId = principal.UserId();
    CompanyEntity? company = null;
    if (!string.IsNullOrWhiteSpace(request.CompanyId))
    {
        company = await db.Companies.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == request.CompanyId);
        if (company is null) return Results.NotFound(new { message = "Firma bulunamadı." });
    }
    else
    {
        // Firma verilmediyse alan adına göre bul ya da oluştur — teklif her zaman bir firmaya bağlanır.
        var domain = uri.Host.StartsWith("www.", StringComparison.OrdinalIgnoreCase) ? uri.Host[4..] : uri.Host;
        var normalizedDomain = NormalizeCompanyLookup(domain);
        company = (await db.Companies.Where(item => item.UserId == userId).ToListAsync())
            .FirstOrDefault(item => NormalizeCompanyLookup(item.Name) == normalizedDomain);
        if (company is null)
        {
            company = new CompanyEntity
            {
                Id = NewId("company"),
                UserId = userId,
                Name = domain,
                Status = "new",
                Tags = "AI-created,from-url",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            };
            db.Companies.Add(company);
        }
    }

    var offer = new OfferEntity
    {
        Id = NewId("offer"),
        UserId = userId,
        CompanyId = company.Id,
        OfferNumber = $"AN-{DateTime.UtcNow:yyyyMMdd-HHmm}",
        OfferDate = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"),
        Title = string.IsNullOrWhiteSpace(request.Title) ? $"Web teklifi — {uri.Host}" : request.Title!.Trim(),
        Status = "draft",
        Currency = scraped.FirstOrDefault(item => !string.IsNullOrWhiteSpace(item.Currency))?.Currency ?? "EUR",
        ValidityDays = 14,
        Notes = $"Kaynak: {uri}"
    };
    offer.Items = scraped.Take(25).Select(product => new OfferItemEntity
    {
        Id = NewId("offer-item"),
        UserId = userId,
        OfferId = offer.Id,
        ProductName = Truncate(product.Name, 160),
        Description = "Linkten alınan ürün",
        Quantity = 1,
        UnitPrice = product.Price,
        TotalPrice = product.Price,
        ImageUrl = product.ImageUrl ?? ""
    }).ToList();
    RecalculateOffer(offer);
    db.Offers.Add(offer);
    db.Timeline.Add(Timeline(userId, company.Id, "offer", "Linkten teklif taslağı oluşturuldu", uri.ToString(), offer.Id));
    await db.SaveChangesAsync();
    return Results.Ok(new { offer, products = scraped.Take(25).ToList() });
});

// --- Belge tarama + OCR + form doldurma (R18) --------------------------------

app.MapPost("/documents/scan", [Authorize] async (
    IFormFile file,
    [FromForm] string? companyId,
    [FromForm] string? documentType,
    [FromForm] string? language,
    ClaimsPrincipal principal,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory,
    IWebHostEnvironment environment) =>
{
    var userId = principal.UserId();
    var saved = await SaveUploadedFileAsync(file, "document", null, userId, db, environment);
    if (saved.Error is not null) return Results.BadRequest(new { message = saved.Error });
    var stored = saved.File!;

    string extractedText = "";
    string summary = "";
    string fieldsJson = "";
    var resolvedType = string.IsNullOrWhiteSpace(documentType) ? "scan" : documentType!.Trim();
    var apiKey = configuration["OpenAI:ApiKey"];
    var isImage = stored.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase);
    if (isImage && !string.IsNullOrWhiteSpace(apiKey))
    {
        var seller = await db.Users.FindAsync(userId);
        var company = string.IsNullOrWhiteSpace(companyId)
            ? null
            : await db.Companies.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == companyId);
        var ocr = await AnalyzeDocumentWithVision(stored, seller, company, language ?? "tr", configuration, httpClientFactory, apiKey!);
        if (ocr is not null)
        {
            extractedText = ocr.Value.ExtractedText;
            summary = ocr.Value.Summary;
            fieldsJson = ocr.Value.FieldsJson;
            if (!string.IsNullOrWhiteSpace(ocr.Value.DocumentType)) resolvedType = ocr.Value.DocumentType;
        }
    }

    var document = new DocumentEntity
    {
        Id = NewId("document"),
        UserId = userId,
        CompanyId = string.IsNullOrWhiteSpace(companyId) ? null : companyId,
        FileName = stored.FileName,
        FileType = stored.ContentType,
        DocumentType = resolvedType,
        ExtractedText = extractedText,
        Summary = summary,
        FieldsJson = fieldsJson,
        FileId = stored.Id,
        UploadedAt = DateTimeOffset.UtcNow
    };
    db.Documents.Add(document);
    stored.RelatedId = document.Id;
    await db.SaveChangesAsync();
    return Results.Ok(new { document, fields = TryParseJson(fieldsJson), ocrAvailable = isImage && !string.IsNullOrWhiteSpace(apiKey) });
}).DisableAntiforgery();

// Çıkarılan alanlardan doldurulmuş temiz bir PDF üretir.
app.MapGet("/documents/{id}/filled-pdf", [Authorize] async (string id, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    var document = await db.Documents.FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (document is null) return Results.NotFound();
    var bytes = BuildFilledFormPdf(document);
    return Results.File(bytes, "application/pdf", $"{SanitizeFileName(document.FileName)}-doldurulmus.pdf");
});

// --- Geç kalma botu (R16) -----------------------------------------------------

app.MapPost("/late-notice/draft", [Authorize] async (
    LateNoticeDraftRequest request,
    ClaimsPrincipal principal,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory) =>
{
    var userId = principal.UserId();
    var task = await db.Tasks.FirstOrDefaultAsync(item => item.Id == request.TaskId && item.UserId == userId);
    if (task is null) return Results.NotFound();
    var company = string.IsNullOrWhiteSpace(task.CompanyId)
        ? null
        : await db.Companies.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == task.CompanyId);
    var user = await db.Users.FindAsync(userId);
    var delayMinutes = Math.Clamp(request.DelayMinutes, 1, 24 * 60);
    var message = BuildLateNoticeMessage(user, company, task, delayMinutes, NormalizeLanguage(request.Language ?? "tr"));

    // OpenAI varsa taslağı doğal bir üsluba çevir; yoksa şablon yeterli.
    var apiKey = configuration["OpenAI:ApiKey"];
    if (!string.IsNullOrWhiteSpace(apiKey))
    {
        var polished = await PolishMessageWithOpenAi(message, NormalizeLanguage(request.Language ?? "tr"), configuration, httpClientFactory, apiKey!);
        if (!string.IsNullOrWhiteSpace(polished)) message = polished!;
    }

    return Results.Ok(new
    {
        message,
        delayMinutes,
        companyName = company?.Name ?? "",
        companyPhone = company?.Phone ?? "",
        requiresApproval = true
    });
});

// Kullanıcı onayladıktan sonra gönderim kaydı (gönderim SMS/WhatsApp ile cihazdan yapılır).
app.MapPost("/late-notice/log", [Authorize] async (LateNoticeLogRequest request, ClaimsPrincipal principal, ArxTaskDbContext db) =>
{
    var userId = principal.UserId();
    var task = await db.Tasks.FirstOrDefaultAsync(item => item.Id == request.TaskId && item.UserId == userId);
    if (task is null) return Results.NotFound();
    if (!string.IsNullOrWhiteSpace(task.CompanyId))
    {
        db.Timeline.Add(Timeline(userId, task.CompanyId!, "late-notice",
            "Gecikme mesajı gönderildi",
            $"[{request.Channel ?? "sms"}] {Truncate(request.Message ?? "", 300)}", task.Id));
        await db.SaveChangesAsync();
    }
    return Results.Ok(new { ok = true });
});

app.Run();

static void EnsureSqliteSchema(ArxTaskDbContext db)
{
    var connection = db.Database.GetDbConnection();
    var shouldClose = connection.State != System.Data.ConnectionState.Open;
    if (shouldClose)
    {
        connection.Open();
    }

    try
    {
        // WAL lets readers run concurrently with the single writer, and busy_timeout makes
        // writers wait-and-retry instead of failing fast — together these tame the
        // "database is locked" contention from Hangfire's parallel reminder workers.
        using (var pragma = connection.CreateCommand())
        {
            pragma.CommandText = "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;";
            pragma.ExecuteNonQuery();
        }

        EnsureColumn(connection, "Tasks", "NotificationsEnabled", "INTEGER NOT NULL DEFAULT 1");
        EnsureColumn(connection, "Tasks", "NextAlertAt", "TEXT NULL");
        EnsureColumn(connection, "Tasks", "AlertCount", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn(connection, "Tasks", "CompletionRequestedAt", "TEXT NULL");
        EnsureColumn(connection, "Tasks", "CompletionRequestedNote", "TEXT NULL");
        EnsureColumn(connection, "Tasks", "LastRejectedAt", "TEXT NULL");
        EnsureColumn(connection, "Tasks", "LastRejectionReason", "TEXT NULL");
        EnsureColumn(connection, "Reminders", "NotificationsEnabled", "INTEGER NOT NULL DEFAULT 1");
        EnsureColumn(connection, "Companies", "ArchivedAt", "TEXT NULL");
        EnsureColumn(connection, "Offers", "Kind", "TEXT NOT NULL DEFAULT 'offer'");
        EnsureColumn(connection, "Tasks", "ContactPersonName", "TEXT NULL");
        EnsureColumn(connection, "Users", "IsAdmin", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn(connection, "Users", "IsSystemAdmin", "INTEGER NOT NULL DEFAULT 0");

        // Satıcı profili + bildirim/ev ayarları (PDF anteti, R10, R15).
        EnsureColumn(connection, "Users", "CompanyName", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn(connection, "Users", "CompanyAddress", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn(connection, "Users", "CompanyPhone", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn(connection, "Users", "CompanyEmail", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn(connection, "Users", "CompanyTaxId", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn(connection, "Users", "CompanyIban", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn(connection, "Users", "PaymentTerms", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn(connection, "Users", "DefaultReminderLeadMinutes", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn(connection, "Users", "HomeLatitude", "REAL NOT NULL DEFAULT 0");
        EnsureColumn(connection, "Users", "HomeLongitude", "REAL NOT NULL DEFAULT 0");
        EnsureColumn(connection, "Users", "HomeAddress", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn(connection, "Users", "DailyDigestEnabled", "INTEGER NOT NULL DEFAULT 1");
        EnsureColumn(connection, "Users", "WeeklyDigestEnabled", "INTEGER NOT NULL DEFAULT 1");

        // Adres doğrulama (R3).
        EnsureColumn(connection, "Companies", "FormattedAddress", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn(connection, "Companies", "AddressVerified", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn(connection, "Companies", "AddressVerifiedAt", "TEXT NULL");

        // Görev atama, fotoğraf kanıtı ve gecikme nedeni (R17, R14).
        EnsureColumn(connection, "Tasks", "AssignedByUserId", "TEXT NULL");
        EnsureColumn(connection, "Tasks", "AcknowledgedAt", "TEXT NULL");
        EnsureColumn(connection, "Tasks", "RequirePhotoProof", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn(connection, "Tasks", "CompletionPhotoId", "TEXT NULL");
        EnsureColumn(connection, "Tasks", "DelayReason", "TEXT NULL");

        // Alışkanlık hedefleri (habit) alanları.
        EnsureColumn(connection, "Tasks", "IsHabit", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn(connection, "Tasks", "HabitStage", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn(connection, "Tasks", "HabitStartDate", "TEXT NULL");
        EnsureColumn(connection, "Tasks", "NudgeIntervalDays", "INTEGER NOT NULL DEFAULT 2");
        EnsureColumn(connection, "Tasks", "HabitReminderTime", "TEXT NOT NULL DEFAULT '20:00'");
        EnsureColumn(connection, "Tasks", "HabitNudgeJobId", "TEXT NULL");
        EnsureColumn(connection, "Tasks", "NextNudgeAt", "TEXT NULL");

        // Linkten teklif görselleri (R7) ve belge dosya bağlantısı (R18).
        EnsureColumn(connection, "OfferItems", "ImageUrl", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn(connection, "Documents", "FileId", "TEXT NULL");
        EnsureColumn(connection, "Documents", "FieldsJson", "TEXT NOT NULL DEFAULT ''");

        // Rota geçmişi (R12) ve durak ziyaret damgası.
        EnsureColumn(connection, "Routes", "Status", "TEXT NOT NULL DEFAULT 'planned'");
        EnsureColumn(connection, "Routes", "Source", "TEXT NOT NULL DEFAULT 'manual'");
        EnsureColumn(connection, "Routes", "StartedAt", "TEXT NULL");
        EnsureColumn(connection, "Routes", "CompletedAt", "TEXT NULL");
        EnsureColumn(connection, "RouteStops", "VisitedAt", "TEXT NULL");

        using var createPushSubscriptions = connection.CreateCommand();
        createPushSubscriptions.CommandText = """
            CREATE TABLE IF NOT EXISTS "PushSubscriptions" (
                "UserId" TEXT NOT NULL,
                "Id" TEXT NOT NULL,
                "Endpoint" TEXT NOT NULL,
                "P256dh" TEXT NOT NULL,
                "Auth" TEXT NOT NULL,
                "UserAgent" TEXT NOT NULL,
                "Platform" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                "LastSeenAt" TEXT NOT NULL,
                "DisabledAt" TEXT NULL,
                CONSTRAINT "PK_PushSubscriptions" PRIMARY KEY ("UserId", "Id")
            );
            """;
        createPushSubscriptions.ExecuteNonQuery();

        using var createMobileDevices = connection.CreateCommand();
        createMobileDevices.CommandText = """
            CREATE TABLE IF NOT EXISTS "MobileDevices" (
                "UserId" TEXT NOT NULL,
                "Id" TEXT NOT NULL,
                "ExpoPushToken" TEXT NOT NULL,
                "DeviceName" TEXT NOT NULL,
                "DeviceModel" TEXT NOT NULL,
                "Platform" TEXT NOT NULL,
                "AppVersion" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                "LastSeenAt" TEXT NOT NULL,
                "DisabledAt" TEXT NULL,
                CONSTRAINT "PK_MobileDevices" PRIMARY KEY ("UserId", "Id")
            );
            """;
        createMobileDevices.ExecuteNonQuery();

        using var createTaskAlerts = connection.CreateCommand();
        createTaskAlerts.CommandText = """
            CREATE TABLE IF NOT EXISTS "TaskAlerts" (
                "UserId" TEXT NOT NULL,
                "Id" TEXT NOT NULL,
                "TaskId" TEXT NOT NULL,
                "ReminderId" TEXT NULL,
                "ScheduledFor" TEXT NOT NULL,
                "Kind" TEXT NOT NULL,
                "Status" TEXT NOT NULL,
                "ActionTokenHash" TEXT NOT NULL,
                "ActionToken" TEXT NOT NULL,
                "SentAt" TEXT NULL,
                "ActedAt" TEXT NULL,
                "HangfireJobId" TEXT NULL,
                CONSTRAINT "PK_TaskAlerts" PRIMARY KEY ("UserId", "Id")
            );
            """;
        createTaskAlerts.ExecuteNonQuery();
        EnsureColumn(connection, "TaskAlerts", "HangfireJobId", "TEXT NULL");

        using var createStoredFiles = connection.CreateCommand();
        createStoredFiles.CommandText = """
            CREATE TABLE IF NOT EXISTS "StoredFiles" (
                "UserId" TEXT NOT NULL,
                "Id" TEXT NOT NULL,
                "FileName" TEXT NOT NULL,
                "ContentType" TEXT NOT NULL,
                "Size" INTEGER NOT NULL,
                "StoragePath" TEXT NOT NULL,
                "Kind" TEXT NOT NULL,
                "RelatedId" TEXT NULL,
                "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "PK_StoredFiles" PRIMARY KEY ("UserId", "Id")
            );
            """;
        createStoredFiles.ExecuteNonQuery();

        using var createShoppingItems = connection.CreateCommand();
        createShoppingItems.CommandText = """
            CREATE TABLE IF NOT EXISTS "ShoppingItems" (
                "UserId" TEXT NOT NULL,
                "Id" TEXT NOT NULL,
                "Name" TEXT NOT NULL,
                "Category" TEXT NOT NULL,
                "Status" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                "CompletedAt" TEXT NULL,
                CONSTRAINT "PK_ShoppingItems" PRIMARY KEY ("UserId", "Id")
            );
            """;
        createShoppingItems.ExecuteNonQuery();
        EnsureColumn(connection, "ShoppingItems", "Chain", "TEXT NOT NULL DEFAULT ''");

        using var createCompanyVisits = connection.CreateCommand();
        createCompanyVisits.CommandText = """
            CREATE TABLE IF NOT EXISTS "CompanyVisits" (
                "UserId" TEXT NOT NULL,
                "Id" TEXT NOT NULL,
                "CompanyId" TEXT NOT NULL,
                "RouteId" TEXT NULL,
                "TaskId" TEXT NULL,
                "Source" TEXT NOT NULL,
                "Note" TEXT NOT NULL,
                "VisitedAt" TEXT NOT NULL,
                CONSTRAINT "PK_CompanyVisits" PRIMARY KEY ("UserId", "Id")
            );
            """;
        createCompanyVisits.ExecuteNonQuery();

        using var createReports = connection.CreateCommand();
        createReports.CommandText = """
            CREATE TABLE IF NOT EXISTS "Reports" (
                "UserId" TEXT NOT NULL,
                "Id" TEXT NOT NULL,
                "Kind" TEXT NOT NULL,
                "Date" TEXT NOT NULL,
                "Payload" TEXT NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                CONSTRAINT "PK_Reports" PRIMARY KEY ("UserId", "Id")
            );
            """;
        createReports.ExecuteNonQuery();
    }
    finally
    {
        if (shouldClose)
        {
            connection.Close();
        }
    }
}

static void SeedAdminUser(ArxTaskDbContext db, IConfiguration configuration, IHostEnvironment environment)
{
    // İki kabul edilebilir admin kullanıcı adı:
    //   - "admin@planix.local" → tarayıcının email validasyonu için geçerli format
    //   - "admin" → eski sürümlerden migrate edilen kullanıcılar için geri uyumluluk
    const string newAdminEmail = "admin@planix.local";
    const string legacyAdminEmail = "admin";
    // İlk admin şifresi konfigürasyondan gelir; production'da yapılandırılmamışsa
    // rastgele üretilir ve bir kez log'a yazılır — sabit "admin9049" yalnızca
    // yerel geliştirmede kalır.
    var defaultPassword = configuration["Admin:InitialPassword"];
    var generatedPassword = false;
    if (string.IsNullOrWhiteSpace(defaultPassword))
    {
        if (environment.IsProduction())
        {
            defaultPassword = Convert.ToHexString(RandomNumberGenerator.GetBytes(12));
            generatedPassword = true;
        }
        else
        {
            defaultPassword = "admin9049";
        }
    }

    var existing = db.Users.FirstOrDefault(item => item.Email == newAdminEmail)
                   ?? db.Users.FirstOrDefault(item => item.Email == legacyAdminEmail);

    if (existing is null)
    {
        db.Users.Add(new AppUser
        {
            Id = NewId("user"),
            Email = newAdminEmail,
            Name = "Yönetici",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(defaultPassword),
            CreatedAt = DateTimeOffset.UtcNow,
            IsAdmin = true,
            IsSystemAdmin = true
        });
        db.SaveChanges();
        if (generatedPassword)
        {
            Console.WriteLine(
                $"[ArxTask] Sistem yöneticisi oluşturuldu: {newAdminEmail} — geçici şifre: {defaultPassword}. " +
                "Kalıcı şifreyi Admin__InitialPassword ortam değişkeniyle belirleyin ve ilk girişte değiştirin.");
        }
        return;
    }

    // Eski "admin" kullanıcı adı varsa yeni geçerli email formatına taşı —
    // tarayıcı login formu artık @ olmadan kabul etmiyor.
    var needsSave = false;
    if (string.Equals(existing.Email, legacyAdminEmail, StringComparison.OrdinalIgnoreCase))
    {
        existing.Email = newAdminEmail;
        needsSave = true;
    }
    if (!existing.IsAdmin) { existing.IsAdmin = true; needsSave = true; }
    if (!existing.IsSystemAdmin) { existing.IsSystemAdmin = true; needsSave = true; }
    if (needsSave) { db.SaveChanges(); }
}

// One-time migration shim: any pending alerts in the table left over from the
// old polling TaskAlertDispatcher (with no HangfireJobId) are re-scheduled as
// Hangfire delayed jobs so nothing falls through during the cutover.
static void ReenqueuePendingAlerts(ArxTaskDbContext db)
{
    var now = DateTimeOffset.Now;
    // SQLite EF Core provider can't translate DateTimeOffset comparisons or
    // nullable-string OR-checks server-side. Pull the pending set down and do
    // every filter in memory — pending alerts are always a small list.
    var pending = db.TaskAlerts
        .Where(item => item.Status == "pending")
        .ToList()
        .Where(item => item.ScheduledFor > now && string.IsNullOrWhiteSpace(item.HangfireJobId))
        .ToList();
    if (pending.Count == 0) return;

    foreach (var alert in pending)
    {
        var delay = alert.ScheduledFor - DateTimeOffset.Now;
        if (delay < TimeSpan.Zero) delay = TimeSpan.Zero;
        try
        {
            var userId = alert.UserId;
            var alertId = alert.Id;
            var jobId = BackgroundJob.Schedule<INotificationDispatcher>(
                svc => svc.SendTaskAlertAsync(userId, alertId),
                delay);
            alert.HangfireJobId = jobId;
        }
        catch
        {
            // Best effort — failed re-enqueue leaves the row pending; next
            // SyncTaskAlertsForTask call cleans up.
        }
    }
    db.SaveChanges();
}

// Yeniden başlatmada: planning aşamasındaki alışkanlıklar için dürtmeyi yeniden planla,
// active alışkanlıklar için günlük recurring hatırlatmayı yeniden kur (Hangfire kalıcı olsa
// da recurring tanımların ve gecikmeli işlerin tutarlı kalması için tekrar kurulur).
static void ReenqueueHabits(ArxTaskDbContext db)
{
    var habits = db.Tasks
        .Where(item => item.IsHabit && item.Status != "done")
        .ToList();
    if (habits.Count == 0) return;
    foreach (var habit in habits)
    {
        try
        {
            if (habit.HabitStage == "planning")
            {
                // Planlanan zaman geçtiyse yakında, değilse kalan süreyle yeniden kur.
                var delay = TimeSpan.FromDays(Math.Max(1, habit.NudgeIntervalDays));
                if (DateTimeOffset.TryParse(habit.NextNudgeAt, out var next))
                {
                    delay = next - DateTimeOffset.Now;
                    if (delay < TimeSpan.FromMinutes(5)) delay = TimeSpan.FromMinutes(5);
                }
                HabitScheduler.ScheduleNudge(habit, delay);
            }
            else if (habit.HabitStage == "active")
            {
                HabitScheduler.ScheduleDailyReminder(habit);
            }
        }
        catch { /* best effort */ }
    }
    db.SaveChanges();
}

static void EnsureColumn(System.Data.Common.DbConnection connection, string tableName, string columnName, string definition)
{
    using var check = connection.CreateCommand();
    check.CommandText = $"PRAGMA table_info(\"{tableName}\");";
    using var reader = check.ExecuteReader();
    var exists = false;
    while (reader.Read())
    {
        if (string.Equals(reader["name"]?.ToString(), columnName, StringComparison.OrdinalIgnoreCase))
        {
            exists = true;
            break;
        }
    }

    reader.Close();
    if (exists)
    {
        return;
    }

    using var alter = connection.CreateCommand();
    alter.CommandText = $"ALTER TABLE \"{tableName}\" ADD COLUMN \"{columnName}\" {definition};";
    alter.ExecuteNonQuery();
}

static async Task<IResult> CreateOwned<T>(ArxTaskDbContext db, ClaimsPrincipal principal, T input, DbSet<T> set)
    where T : class, IOwnedEntity
{
    input.Id = string.IsNullOrWhiteSpace(input.Id) ? NewId(EntityPrefix(typeof(T))) : input.Id;
    input.UserId = principal.UserId();
    set.Add(input);
    await db.SaveChangesAsync();
    return Results.Ok(input);
}

static async Task<IResult> DeleteOwned<T>(string id, ClaimsPrincipal principal, ArxTaskDbContext db, DbSet<T> set)
    where T : class, IOwnedEntity
{
    var userId = principal.UserId();
    var entity = await set.FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (entity is null)
    {
        return Results.NotFound();
    }

    set.Remove(entity);
    await db.SaveChangesAsync();
    return Results.NoContent();
}

static async Task<IResult> DeleteTask(string id, ClaimsPrincipal principal, ArxTaskDbContext db)
{
    var userId = principal.UserId();
    var task = await db.Tasks.FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (task is null)
    {
        return Results.NotFound();
    }

    var reminders = await db.Reminders.Where(item => item.UserId == userId && item.TaskId == id).ToListAsync();
    var alerts = await db.TaskAlerts.Where(item => item.UserId == userId && item.TaskId == id && item.Status == "pending").ToListAsync();
    if (reminders.Count > 0)
    {
        db.Reminders.RemoveRange(reminders);
    }
    if (alerts.Count > 0)
    {
        db.TaskAlerts.RemoveRange(alerts);
    }
    // Alışkanlık görevi siliniyorsa dürtme + günlük hatırlatma işlerini de kaldır.
    if (task.IsHabit)
    {
        HabitScheduler.RemoveJobs(task);
    }

    db.Tasks.Remove(task);
    await db.SaveChangesAsync();
    return Results.NoContent();
}

static async Task<IResult> UpdateCompany(string id, ClaimsPrincipal principal, CompanyEntity input, ArxTaskDbContext db, IConfiguration configuration, IHttpClientFactory httpClientFactory)
{
    var existing = await db.Companies.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (existing is null) return Results.NotFound();
    var addressChanged = !string.Equals(existing.Address?.Trim(), input.Address?.Trim(), StringComparison.Ordinal);
    existing.Name = input.Name;
    existing.Address = input.Address ?? "";
    existing.Phone = input.Phone;
    existing.Email = input.Email;
    existing.ContactPerson = input.ContactPerson;
    // Eski istemciler koordinat alanlarını 0 gönderebilir — doğrulanmış konumu silme.
    if (input.Latitude != 0 || input.Longitude != 0)
    {
        existing.Latitude = input.Latitude;
        existing.Longitude = input.Longitude;
    }
    existing.Status = input.Status;
    existing.Tags = input.Tags;
    existing.UpdatedAt = DateTimeOffset.UtcNow;
    if (addressChanged)
    {
        // Adres değişti — eski doğrulama geçersiz; yeni adresi geocode ile teyit et.
        existing.AddressVerified = false;
        existing.FormattedAddress = "";
        existing.AddressVerifiedAt = null;
        await GeocodeCompanyAsync(existing, configuration, httpClientFactory);
    }
    await db.SaveChangesAsync();
    return Results.Ok(existing);
}

static async Task<IResult> UpdateModule(string id, ClaimsPrincipal principal, WorkModuleEntity input, ArxTaskDbContext db)
{
    var existing = await db.Modules.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (existing is null) return Results.NotFound();
    existing.Name = input.Name;
    existing.Type = input.Type;
    existing.IsPinnedToSidebar = input.IsPinnedToSidebar;
    existing.TaskCount = input.TaskCount;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
}

static async Task<IResult> UpdateTask(string id, ClaimsPrincipal principal, BusinessTaskEntity input, ArxTaskDbContext db)
{
    var existing = await db.Tasks.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (existing is null) return Results.NotFound();

    // Guard: non-admins cannot use PUT to mark a task as done. They must call
    // POST /tasks/{id}/request-completion which routes through the approval queue.
    if (!principal.IsAdmin() && input.Status == "done" && existing.Status != "done")
    {
        return Results.Problem(
            "Görevi tamamlamak için onay isteği göndermelisiniz.",
            statusCode: StatusCodes.Status403Forbidden);
    }

    existing.CompanyId = input.CompanyId;
    existing.Title = input.Title;
    existing.Description = input.Description;
    existing.Type = input.Type;
    existing.ModuleIds = input.ModuleIds;
    existing.DueDate = input.DueDate;
    existing.DueTime = input.DueTime;
    existing.TimeWindow = input.TimeWindow;
    existing.ReminderInterval = input.ReminderInterval;
    existing.RepeatUntilDone = input.RepeatUntilDone;
    existing.Status = input.Status;
    existing.Priority = input.Priority;
    existing.NotificationsEnabled = input.NotificationsEnabled;
    existing.CompletedAt = input.CompletedAt;
    // If an admin or the task itself moves out of pending_approval via PUT,
    // clear the approval-tracking metadata.
    if (input.Status != "pending_approval")
    {
        existing.CompletionRequestedAt = null;
        existing.CompletionRequestedNote = null;
    }
    var reminder = await db.Reminders.FirstOrDefaultAsync(item => item.UserId == principal.UserId() && item.TaskId == existing.Id);
    await SyncTaskAlertsForTask(db, principal.UserId(), existing, reminder);
    await db.SaveChangesAsync();
    return Results.Ok(existing);
}

static async Task<IResult> RequestTaskCompletion(
    string id,
    ClaimsPrincipal principal,
    TaskCompletionRequest? request,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory)
{
    var userId = principal.UserId();
    var task = await db.Tasks.FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (task is null) return Results.NotFound();

    var note = request?.Note?.Trim();
    if (string.IsNullOrWhiteSpace(note)) note = null;

    // Fotoğraf kanıtı zorunlu görevlerde (yönetici atamaları) foto olmadan tamamlama isteği kabul edilmez.
    var photoFileId = request?.PhotoFileId?.Trim();
    if (task.RequirePhotoProof && !principal.IsAdmin())
    {
        if (string.IsNullOrWhiteSpace(photoFileId))
        {
            return Results.BadRequest(new { message = "Bu görev fotoğraf kanıtı olmadan tamamlanamaz. Lütfen iş fotoğrafı ekleyin.", requiresPhoto = true });
        }
        var photo = await db.StoredFiles.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == photoFileId);
        if (photo is null)
        {
            return Results.BadRequest(new { message = "Fotoğraf bulunamadı — yeniden yükleyin.", requiresPhoto = true });
        }
    }
    if (!string.IsNullOrWhiteSpace(photoFileId))
    {
        task.CompletionPhotoId = photoFileId;
    }

    // Admins (or system admin) finishing their own task → straight to done, no approval flow.
    if (principal.IsAdmin())
    {
        task.Status = "done";
        task.CompletedAt = DateTimeOffset.UtcNow.ToString("O");
        task.CompletionRequestedAt = null;
        task.CompletionRequestedNote = null;
        task.LastRejectedAt = null;
        task.LastRejectionReason = null;
        var reminder = await db.Reminders.FirstOrDefaultAsync(item => item.UserId == userId && item.TaskId == task.Id);
        await SyncTaskAlertsForTask(db, userId, task, reminder);
        await db.SaveChangesAsync();
        return Results.Ok(task);
    }

    task.Status = "pending_approval";
    task.CompletionRequestedAt = DateTimeOffset.UtcNow.ToString("O");
    task.CompletionRequestedNote = note;
    // Re-submitting clears the previous rejection marker (the task is no longer "rejected").
    task.LastRejectedAt = null;
    task.LastRejectionReason = null;
    await db.SaveChangesAsync();

    // Notify all admins immediately.
    var requester = await db.Users.FindAsync(userId);
    var adminIds = await db.Users
        .Where(item => item.IsAdmin && item.Id != userId)
        .Select(item => item.Id)
        .ToListAsync();
    if (adminIds.Count > 0)
    {
        var company = task.CompanyId is null
            ? null
            : await db.Companies.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == task.CompanyId);
        var bodyBase = $"{requester?.Name ?? "Bir kullanıcı"} → {task.Title}";
        var body = note is null ? bodyBase : $"{bodyBase} · {Truncate(note, 80)}";
        var payload = new PushPayload(
            Title: "Onay bekleyen görev",
            Body: body,
            Url: "/admin/approvals",
            TaskId: task.Id,
            CategoryId: "approval-request",
            ExtraData: new Dictionary<string, object?>
            {
                ["requesterId"] = userId,
                ["requesterName"] = requester?.Name ?? "",
                ["companyName"] = company?.Name ?? "",
                ["note"] = note ?? ""
            });
        await PushDispatcher.DispatchPushNow(db, httpClientFactory, configuration, adminIds, payload);
    }

    return Results.Ok(task);
}

static string Truncate(string value, int max) =>
    value.Length <= max ? value : value[..max] + "…";

static async Task<List<object>> JoinAdminTaskMetadata(ArxTaskDbContext db, List<BusinessTaskEntity> tasks)
{
    if (tasks.Count == 0) return new List<object>();
    var userIds = tasks.Select(item => item.UserId).Distinct().ToList();
    var companyIds = tasks.Where(item => item.CompanyId is not null).Select(item => item.CompanyId!).Distinct().ToList();
    var users = await db.Users.Where(item => userIds.Contains(item.Id)).ToDictionaryAsync(item => item.Id);
    var companies = await db.Companies.Where(item => companyIds.Contains(item.Id)).ToDictionaryAsync(item => item.Id);
    return tasks.Select(task => (object)new
    {
        task = task,
        user = users.TryGetValue(task.UserId, out var user) ? new { id = user.Id, name = user.Name, email = user.Email } : null,
        company = task.CompanyId is not null && companies.TryGetValue(task.CompanyId, out var company)
            ? new { id = company.Id, name = company.Name, address = company.Address }
            : null,
        // Onay ekranında yönetici tamamlanma fotoğrafını buradan görüntüler.
        completionPhotoUrl = string.IsNullOrWhiteSpace(task.CompletionPhotoId) ? null : $"/files/{task.CompletionPhotoId}"
    }).ToList();
}

static async Task<IResult> UpdateNote(string id, ClaimsPrincipal principal, NoteEntity input, ArxTaskDbContext db)
{
    var existing = await db.Notes.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (existing is null) return Results.NotFound();
    existing.CompanyId = input.CompanyId;
    existing.TaskId = input.TaskId;
    existing.Content = input.Content;
    existing.SourceType = input.SourceType;
    existing.SourceTranscript = input.SourceTranscript;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
}

static async Task<IResult> UpdateProduct(string id, ClaimsPrincipal principal, ProductEntity input, ArxTaskDbContext db)
{
    var existing = await db.Products.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (existing is null) return Results.NotFound();
    existing.Name = input.Name;
    existing.Category = input.Category;
    existing.Description = input.Description;
    existing.CostPrice = input.CostPrice;
    existing.SellingPrice = input.SellingPrice;
    existing.MinimumPrice = input.MinimumPrice;
    existing.Currency = input.Currency;
    existing.Margin = input.Margin;
    existing.UpdatedAt = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
    await db.SaveChangesAsync();
    return Results.Ok(existing);
}

static async Task<IResult> UpdateDocument(string id, ClaimsPrincipal principal, DocumentEntity input, ArxTaskDbContext db)
{
    var existing = await db.Documents.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (existing is null) return Results.NotFound();
    existing.CompanyId = input.CompanyId;
    existing.FileName = input.FileName;
    existing.FileType = input.FileType;
    existing.DocumentType = input.DocumentType;
    existing.ExtractedText = input.ExtractedText;
    existing.Summary = input.Summary;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
}

static async Task<IResult> UpdateReminder(string id, ClaimsPrincipal principal, ReminderEntity input, ArxTaskDbContext db)
{
    var existing = await db.Reminders.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (existing is null) return Results.NotFound();
    existing.TaskId = input.TaskId;
    existing.StartTime = input.StartTime;
    existing.RepeatInterval = input.RepeatInterval;
    existing.ActiveUntilDone = input.ActiveUntilDone;
    existing.Status = input.Status;
    existing.NotificationsEnabled = input.NotificationsEnabled;
    var task = await db.Tasks.FirstOrDefaultAsync(item => item.UserId == principal.UserId() && item.Id == existing.TaskId);
    if (task is not null)
    {
        await SyncTaskAlertsForTask(db, principal.UserId(), task, existing);
    }
    await db.SaveChangesAsync();
    return Results.Ok(existing);
}

static async Task<IResult> SavePushSubscription(ClaimsPrincipal principal, PushSubscriptionRequest request, ArxTaskDbContext db)
{
    if (string.IsNullOrWhiteSpace(request.Endpoint) || string.IsNullOrWhiteSpace(request.P256dh) || string.IsNullOrWhiteSpace(request.Auth))
    {
        return Results.BadRequest(new { message = "Push subscription is incomplete." });
    }

    var userId = principal.UserId();
    var existing = await db.PushSubscriptions.FirstOrDefaultAsync(item => item.UserId == userId && item.Endpoint == request.Endpoint);
    if (existing is null)
    {
        existing = new PushSubscriptionEntity
        {
            Id = NewId("push-sub"),
            UserId = userId,
            Endpoint = request.Endpoint,
            P256dh = request.P256dh,
            Auth = request.Auth,
            UserAgent = request.UserAgent ?? "",
            Platform = request.Platform ?? "web",
            CreatedAt = DateTimeOffset.UtcNow,
            LastSeenAt = DateTimeOffset.UtcNow,
            DisabledAt = null
        };
        db.PushSubscriptions.Add(existing);
    }
    else
    {
        existing.P256dh = request.P256dh;
        existing.Auth = request.Auth;
        existing.UserAgent = request.UserAgent ?? existing.UserAgent;
        existing.Platform = request.Platform ?? existing.Platform;
        existing.LastSeenAt = DateTimeOffset.UtcNow;
        existing.DisabledAt = null;
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { subscribed = true });
}

static async Task<IResult> RemovePushSubscription(ClaimsPrincipal principal, PushSubscriptionDeleteRequest request, ArxTaskDbContext db)
{
    var userId = principal.UserId();
    var existing = await db.PushSubscriptions.FirstOrDefaultAsync(item => item.UserId == userId && item.Endpoint == request.Endpoint);
    if (existing is null)
    {
        return Results.NoContent();
    }

    existing.DisabledAt = DateTimeOffset.UtcNow;
    existing.LastSeenAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();
    return Results.NoContent();
}

static async Task<IResult> SaveMobileDevice(ClaimsPrincipal principal, MobileDeviceRequest request, ArxTaskDbContext db)
{
    if (string.IsNullOrWhiteSpace(request.ExpoPushToken))
    {
        return Results.BadRequest(new { message = "Expo push token is required." });
    }

    var userId = principal.UserId();
    var existing = await db.MobileDevices.FirstOrDefaultAsync(item => item.UserId == userId && item.ExpoPushToken == request.ExpoPushToken);
    if (existing is null)
    {
        existing = new MobileDeviceEntity
        {
            Id = NewId("mobile-device"),
            UserId = userId,
            ExpoPushToken = request.ExpoPushToken,
            DeviceName = request.DeviceName ?? "",
            DeviceModel = request.DeviceModel ?? "",
            Platform = request.Platform ?? "android",
            AppVersion = request.AppVersion ?? "",
            CreatedAt = DateTimeOffset.UtcNow,
            LastSeenAt = DateTimeOffset.UtcNow
        };
        db.MobileDevices.Add(existing);
    }
    else
    {
        existing.DeviceName = request.DeviceName ?? existing.DeviceName;
        existing.DeviceModel = request.DeviceModel ?? existing.DeviceModel;
        existing.Platform = request.Platform ?? existing.Platform;
        existing.AppVersion = request.AppVersion ?? existing.AppVersion;
        existing.LastSeenAt = DateTimeOffset.UtcNow;
        existing.DisabledAt = null;
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { subscribed = true });
}

static async Task<IResult> RemoveMobileDevice(ClaimsPrincipal principal, MobileDeviceDeleteRequest request, ArxTaskDbContext db)
{
    var userId = principal.UserId();
    var existing = await db.MobileDevices.FirstOrDefaultAsync(item => item.UserId == userId && item.ExpoPushToken == request.ExpoPushToken);
    if (existing is null)
    {
        return Results.NoContent();
    }

    existing.DisabledAt = DateTimeOffset.UtcNow;
    existing.LastSeenAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();
    return Results.NoContent();
}

static async Task<IResult> ApplyNotificationAction(
    NotificationActionRequest request,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory)
{
    if (string.IsNullOrWhiteSpace(request.Token) || string.IsNullOrWhiteSpace(request.Action))
    {
        return Results.BadRequest(new { message = "Notification action token and action are required." });
    }

    var tokenHash = HashToken(request.Token);
    var alert = await db.TaskAlerts.FirstOrDefaultAsync(item => item.ActionTokenHash == tokenHash && item.Status != "cancelled");
    if (alert is null)
    {
        return Results.NotFound();
    }

    var task = await db.Tasks.FirstOrDefaultAsync(item => item.UserId == alert.UserId && item.Id == alert.TaskId);
    if (task is null)
    {
        alert.Status = "cancelled";
        alert.ActedAt = DateTimeOffset.UtcNow;
        alert.ActionToken = "";
        await db.SaveChangesAsync();
        return Results.Ok(new { ok = true });
    }

    var owner = await db.Users.FindAsync(alert.UserId);
    var reminder = await db.Reminders.FirstOrDefaultAsync(item => item.UserId == alert.UserId && item.Id == alert.ReminderId);
    var action = request.Action.Trim().ToLowerInvariant();
    if (action is "complete" or "done")
    {
        // Admins finish their own task directly; everyone else triggers the approval flow.
        if (owner is { IsAdmin: true })
        {
            task.Status = "done";
            task.CompletedAt = DateTimeOffset.UtcNow.ToString("O");
            task.CompletionRequestedAt = null;
            task.CompletionRequestedNote = null;
            task.LastRejectedAt = null;
            task.LastRejectionReason = null;
        }
        else
        {
            task.Status = "pending_approval";
            task.CompletionRequestedAt = DateTimeOffset.UtcNow.ToString("O");
            task.LastRejectedAt = null;
            task.LastRejectionReason = null;

            var adminIds = await db.Users
                .Where(item => item.IsAdmin && item.Id != alert.UserId)
                .Select(item => item.Id)
                .ToListAsync();
            if (adminIds.Count > 0)
            {
                var payload = new PushPayload(
                    Title: "Onay bekleyen görev",
                    Body: $"{owner?.Name ?? "Bir kullanıcı"} → {task.Title}",
                    Url: "/admin/approvals",
                    TaskId: task.Id,
                    CategoryId: "approval-request",
                    ExtraData: new Dictionary<string, object?>
                    {
                        ["requesterId"] = alert.UserId,
                        ["requesterName"] = owner?.Name ?? ""
                    });
                await PushDispatcher.DispatchPushNow(db, httpClientFactory, configuration, adminIds, payload);
            }
        }
    }
    else if (action is "snooze-1h" or "snooze")
    {
        if (TryShiftTaskDueTime(task, 1))
        {
            task.Status = "snoozed";
            task.ReminderInterval = "1h snooze";
        }
    }
    else if (action is "disable" or "disable-reminders")
    {
        if (reminder is not null)
        {
            reminder.Status = "paused";
            reminder.NotificationsEnabled = false;
        }
        task.NotificationsEnabled = false;
    }
    else if (action is "habit-later")
    {
        // "Sonra hatırlat": alışkanlık dürtmesini birkaç gün ertele.
        if (task.IsHabit && task.HabitStage == "planning")
        {
            HabitScheduler.ScheduleNudge(task, TimeSpan.FromDays(Math.Max(1, task.NudgeIntervalDays)));
        }
    }
    // "habit-set-date" bir uygulama-içi derin bağlantıdır; sunucuda ekstra iş yok, token kapatılır.

    alert.Status = "acted";
    alert.ActedAt = DateTimeOffset.UtcNow;
    // Tek kullanımlık token işini bitirdi — düz metin kopyasını veritabanında tutma.
    alert.ActionToken = "";
    await SyncTaskAlertsForTask(db, alert.UserId, task, reminder);
    await db.SaveChangesAsync();
    return Results.Ok(new { ok = true, taskId = task.Id });
}

static async Task<IResult> CreateOffer(ClaimsPrincipal principal, OfferEntity input, ArxTaskDbContext db)
{
    input.Id = string.IsNullOrWhiteSpace(input.Id) ? NewId("offer") : input.Id;
    input.UserId = principal.UserId();
    input.Items = input.Items.Select(item =>
    {
        item.Id = string.IsNullOrWhiteSpace(item.Id) ? NewId("offer-item") : item.Id;
        item.UserId = input.UserId;
        item.OfferId = input.Id;
        return item;
    }).ToList();
    RecalculateOffer(input);
    db.Offers.Add(input);
    await db.SaveChangesAsync();
    return Results.Ok(input);
}

static async Task<IResult> UpdateOffer(string id, ClaimsPrincipal principal, OfferEntity input, ArxTaskDbContext db)
{
    var userId = principal.UserId();
    var existing = await db.Offers.Include(item => item.Items).FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (existing is null) return Results.NotFound();
    existing.CompanyId = input.CompanyId;
    existing.OfferNumber = input.OfferNumber;
    existing.OfferDate = input.OfferDate;
    existing.Title = input.Title;
    existing.Status = input.Status;
    existing.Currency = input.Currency;
    existing.ValidityDays = input.ValidityDays;
    existing.Notes = input.Notes;
    existing.PdfUrl = input.PdfUrl;
    db.OfferItems.RemoveRange(existing.Items);
    existing.Items = input.Items.Select(item =>
    {
        item.Id = string.IsNullOrWhiteSpace(item.Id) ? NewId("offer-item") : item.Id;
        item.UserId = userId;
        item.OfferId = id;
        return item;
    }).ToList();
    RecalculateOffer(existing);
    await db.SaveChangesAsync();
    return Results.Ok(existing);
}

static async Task<IResult> DeleteOffer(string id, ClaimsPrincipal principal, ArxTaskDbContext db)
{
    var offer = await db.Offers.Include(item => item.Items).FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (offer is null) return Results.NotFound();
    db.Offers.Remove(offer);
    await db.SaveChangesAsync();
    return Results.NoContent();
}

static async Task<IResult> SendOffer(string id, ClaimsPrincipal principal, ArxTaskDbContext db)
{
    var userId = principal.UserId();
    var offer = await db.Offers.FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (offer is null) return Results.NotFound();
    offer.Status = "sent";
    var task = new BusinessTaskEntity
    {
        Id = NewId("task"),
        UserId = userId,
        CompanyId = offer.CompanyId,
        Title = $"Follow up offer {offer.OfferNumber}",
        Description = "Automatically created 3 days after sending an offer.",
        Type = "offers",
        ModuleIds = "module-offers,module-calls",
        DueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(3)).ToString("yyyy-MM-dd"),
        DueTime = null,
        TimeWindow = null,
        ReminderInterval = "Daily",
        RepeatUntilDone = true,
        Status = "open",
        Priority = "medium",
        CreatedAt = DateTimeOffset.UtcNow,
        CompletedAt = null
    };
    db.Tasks.Add(task);
    db.Timeline.Add(Timeline(userId, offer.CompanyId, "offer", "Offer sent", $"Follow-up task created for {offer.OfferNumber}.", offer.Id));
    await db.SaveChangesAsync();
    return Results.Ok(new { offer, followUpTask = task });
}

static async Task<IResult> AcceptOffer(string id, ClaimsPrincipal principal, ArxTaskDbContext db)
{
    var userId = principal.UserId();
    var offer = await db.Offers.FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (offer is null) return Results.NotFound();
    offer.Status = "accepted";

    // Advance the workflow: an accepted offer needs a concrete next action (turn it into an
    // invoice / plan delivery), mirroring the follow-up task that SendOffer creates.
    var followUpTask = new BusinessTaskEntity
    {
        Id = NewId("task"),
        UserId = userId,
        CompanyId = offer.CompanyId,
        Title = $"Teklif kabul edildi: {offer.OfferNumber} — faturaya dönüştür / teslimat planla",
        Description = "Kabul edilen teklif sonrası otomatik oluşturuldu.",
        Type = "invoices",
        ModuleIds = "module-invoices,module-offers",
        DueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)).ToString("yyyy-MM-dd"),
        DueTime = null,
        TimeWindow = null,
        ReminderInterval = "Daily",
        RepeatUntilDone = true,
        Status = "open",
        Priority = "high",
        CreatedAt = DateTimeOffset.UtcNow,
        CompletedAt = null
    };
    db.Tasks.Add(followUpTask);
    db.Timeline.Add(Timeline(userId, offer.CompanyId, "offer", "Offer accepted", $"{offer.OfferNumber} accepted. Follow-up task created.", offer.Id));
    await db.SaveChangesAsync();
    return Results.Ok(new { offer, followUpTask });
}

static async Task<IResult> ConvertOfferToInvoice(string id, ClaimsPrincipal principal, ArxTaskDbContext db)
{
    var userId = principal.UserId();
    var offer = await db.Offers.Include(item => item.Items).FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (offer is null) return Results.NotFound();
    // Idempotency guard: a retried / double-tapped conversion must not create a second
    // invoice. Once the offer is marked converted, refuse further conversions.
    if (string.Equals(offer.Status, "convertedToInvoice", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Conflict(new { message = "Offer has already been converted to an invoice." });
    }
    offer.Status = "convertedToInvoice";
    var invoiceId = NewId("invoice");
    var invoice = new InvoiceEntity
    {
        Id = invoiceId,
        UserId = userId,
        CompanyId = offer.CompanyId,
        // Seconds + a short id fragment so two conversions in the same minute cannot collide.
        InvoiceNumber = $"RE-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{invoiceId[^4..]}",
        InvoiceDate = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"),
        DueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(14)).ToString("yyyy-MM-dd"),
        Status = "unpaid",
        Subtotal = offer.Subtotal,
        VatRate = offer.VatRate,
        Total = offer.Total,
        PaidAt = null,
        Items = offer.Items.Select(item => new InvoiceItemEntity
        {
            Id = NewId("invoice-item"),
            UserId = userId,
            ProductName = item.ProductName,
            Description = item.Description,
            Quantity = item.Quantity,
            UnitPrice = item.UnitPrice,
            TotalPrice = item.TotalPrice
        }).ToList()
    };
    foreach (var item in invoice.Items)
    {
        item.InvoiceId = invoice.Id;
    }
    db.Invoices.Add(invoice);
    db.Timeline.Add(Timeline(userId, offer.CompanyId, "invoice", "Invoice created from accepted offer", invoice.InvoiceNumber, invoice.Id));
    await db.SaveChangesAsync();
    return Results.Ok(invoice);
}

static async Task<IResult> CreateInvoice(ClaimsPrincipal principal, InvoiceEntity input, ArxTaskDbContext db)
{
    input.Id = string.IsNullOrWhiteSpace(input.Id) ? NewId("invoice") : input.Id;
    input.UserId = principal.UserId();
    input.Items = input.Items.Select(item =>
    {
        item.Id = string.IsNullOrWhiteSpace(item.Id) ? NewId("invoice-item") : item.Id;
        item.UserId = input.UserId;
        item.InvoiceId = input.Id;
        return item;
    }).ToList();
    RecalculateInvoice(input);
    db.Invoices.Add(input);
    await db.SaveChangesAsync();
    return Results.Ok(input);
}

static async Task<IResult> UpdateInvoice(string id, ClaimsPrincipal principal, InvoiceEntity input, ArxTaskDbContext db)
{
    var userId = principal.UserId();
    var existing = await db.Invoices.Include(item => item.Items).FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId);
    if (existing is null) return Results.NotFound();
    existing.CompanyId = input.CompanyId;
    existing.InvoiceNumber = input.InvoiceNumber;
    existing.InvoiceDate = input.InvoiceDate;
    existing.DueDate = input.DueDate;
    existing.Status = input.Status;
    existing.VatRate = input.VatRate;
    existing.PaidAt = input.PaidAt;
    db.InvoiceItems.RemoveRange(existing.Items);
    existing.Items = input.Items.Select(item =>
    {
        item.Id = string.IsNullOrWhiteSpace(item.Id) ? NewId("invoice-item") : item.Id;
        item.UserId = userId;
        item.InvoiceId = id;
        return item;
    }).ToList();
    RecalculateInvoice(existing);
    await db.SaveChangesAsync();
    return Results.Ok(existing);
}

static async Task<IResult> DeleteInvoice(string id, ClaimsPrincipal principal, ArxTaskDbContext db)
{
    var invoice = await db.Invoices.Include(item => item.Items).FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (invoice is null) return Results.NotFound();
    db.Invoices.Remove(invoice);
    await db.SaveChangesAsync();
    return Results.NoContent();
}

static async Task<IResult> MarkInvoicePaid(string id, ClaimsPrincipal principal, ArxTaskDbContext db)
{
    var invoice = await db.Invoices.FirstOrDefaultAsync(item => item.Id == id && item.UserId == principal.UserId());
    if (invoice is null) return Results.NotFound();
    invoice.Status = "paid";
    invoice.PaidAt = DateTimeOffset.UtcNow.ToString("O");
    db.Timeline.Add(Timeline(invoice.UserId, invoice.CompanyId, "payment", "Invoice marked as paid", invoice.InvoiceNumber, invoice.Id));
    await db.SaveChangesAsync();
    return Results.Ok(invoice);
}

static async Task<IResult> CreateRoute(ClaimsPrincipal principal, RouteEntity input, ArxTaskDbContext db)
{
    input.Id = string.IsNullOrWhiteSpace(input.Id) ? NewId("route") : input.Id;
    input.UserId = principal.UserId();
    input.Stops = input.Stops.Select(stop =>
    {
        stop.Id = string.IsNullOrWhiteSpace(stop.Id) ? NewId("stop") : stop.Id;
        stop.UserId = input.UserId;
        stop.RouteId = input.Id;
        return stop;
    }).ToList();
    db.Routes.Add(input);
    await db.SaveChangesAsync();
    return Results.Ok(input);
}

static async Task<IResult> AnalyzeAndCommitCapture(
    ClaimsPrincipal principal,
    AiCaptureAnalyzeRequest request,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory)
{
    // Null-guard BEFORE dereferencing: SourceText is a non-nullable record parameter at
    // compile time, but System.Text.Json binds a missing/explicit-null field to null at
    // runtime, so `.Trim()` here would throw an unhandled NRE (opaque 500) instead of 400.
    if (string.IsNullOrWhiteSpace(request.SourceText))
    {
        return Results.BadRequest(new { message = "Source text is required." });
    }
    var sourceText = request.SourceText.Trim();

    var apiKey = configuration["OpenAI:ApiKey"];
    if (string.IsNullOrWhiteSpace(apiKey))
    {
        return Results.Problem("OpenAI API key is not configured. Set OpenAI__ApiKey before starting the API.", statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    var userId = principal.UserId();
    var existingCompanies = await db.Companies.Where(item => item.UserId == userId).OrderBy(item => item.Name).Select(item => item.Name).Take(80).ToListAsync();
    var existingModules = await db.Modules.Where(item => item.UserId == userId).OrderBy(item => item.Name).Select(item => item.Name).Take(80).ToListAsync();
    var productCatalog = await db.Products.Where(item => item.UserId == userId).OrderBy(item => item.Name).Take(120).ToListAsync();
    try
    {
        var analysis = await AnalyzeWithOpenAi(sourceText, request.Language, existingCompanies, existingModules, productCatalog, configuration, httpClientFactory, apiKey);
        var companyResolution = await BuildCompanyResolutionPrompt(db, userId, analysis, request.SourceText);
        if (companyResolution is not null && request.CompanyResolution is null)
        {
            return Results.Ok(new AiCaptureAnalyzeResponse(
                await BuildSnapshot(db, userId),
                analysis,
                new AiCreatedRecords(null, [], [], []),
                companyResolution,
                true,
                null,
                false,
                null));
        }

        var addressResolutions = await BuildCompanyAddressPrompts(db, userId, analysis, request.SourceText, request.CompanyResolution, request.CompanyDrafts, request.CompanyDraft);
        if (addressResolutions.Count > 0 && string.IsNullOrWhiteSpace(request.CompanyResolution?.ExistingCompanyId))
        {
            return Results.Ok(new AiCaptureAnalyzeResponse(
                await BuildSnapshot(db, userId),
                analysis,
                new AiCreatedRecords(null, [], [], []),
                null,
                false,
                addressResolutions[0],
                true,
                addressResolutions));
        }

        var created = await CommitAiAnalysis(userId, request, analysis, db);
        // AI akışında oluşan/adres kazanan firmalar koordinat alsın (rota + geofence).
        await GeocodePendingCompanies(db, userId, configuration, httpClientFactory);
        return Results.Ok(new AiCaptureAnalyzeResponse(await BuildSnapshot(db, userId), analysis, created, null, false, null, false, null));
    }
    catch (JsonException)
    {
        return Results.Problem("AI analysis JSON could not be parsed. Please edit the note and try again.", statusCode: StatusCodes.Status502BadGateway);
    }
    catch (InvalidOperationException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
}

static async Task<AiCaptureAnalysis> AnalyzeWithOpenAi(
    string sourceText,
    string language,
    List<string> existingCompanies,
    List<string> existingModules,
    List<ProductEntity> productCatalog,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory,
    string apiKey)
{
    var today = DateOnly.FromDateTime(DateTime.Now).ToString("yyyy-MM-dd");
    var model = configuration["OpenAI:ChatModel"] ?? "gpt-4o-mini";
    var systemPrompt = """
You are the business memory parser for Planix — a Turkish field-operations CRM. Your only job is to convert one short user note (voice or text) into a strict JSON object that downstream code can commit without any guessing.

# OUTPUT FORMAT
- Output ONE JSON object. No markdown fences, no commentary, no leading/trailing whitespace.
- All natural-language fields (title, description, notes, reminderRule, module name) stay in the same language as the user's note.
- Only enum-like fields (type, priority) use the canonical English values listed below.
- Dates are ISO `yyyy-MM-dd`. Times are 24h `HH:mm` (e.g., "12.00", "12'da", "12'de" → "12:00").
- "yarın" / "tomorrow" / "morgen" → compute from the `today` value supplied in the user message.

# ENUMS
- task.type: one of `todo`, `visits`, `calls`, `offers`, `invoices`, `installation`, `removal`, `repair`, `support`, `payments`, `projects`, `delivery`, `measurements`, `custom`
- task.priority: one of `low`, `medium`, `high`

# CORE PRINCIPLES (read in order)

## 1. Task splitting
Each distinct action becomes its own task. "Mara'ya uğra ve Ahmet'le konuş" → 2 tasks. Do NOT merge sequential actions.

## 2. Brand vs Action separation (MOST COMMON BUG)
The title holds the action (verb phrase). The companyName holds ONLY the brand. They are NEVER concatenated.

`title` = what to do ("Montaja git", "Fiyat teklifi al", "Ölçüm al", "Ziyaret et")
`companyName` = where / for whom ("Ensar Döner", "Mara Market", "Sahin Otomotiv")

A noun like **Montaj**, **Kurulum**, **Ziyaret**, **Teklif**, **Fiyat teklifi**, **Ölçüm**, **Satış**, **Kontrol**, **Bilgi**, **Görüşme**, **Toplantı** on its own is NEVER a company name. It is the activity. The company is the entity attached via a dative/instrumental marker (`-e`, `-ya`, `-le`, `ile`).

❌ companyName: "Montaj" — banned
❌ companyName: "Fiyat Teklifi Al Ahmet Döner" — banned (verbs prepended to brand)
✅ companyName: "Ensar Döner" — clean brand
✅ companyName: "Mara Market" — clean brand

## 3. Person vs Business detection
A note can name either a **business** (gets `companyName`) or a **personal contact** (gets `contactPersonName`). Never both for the same task.

Treat as BUSINESS — set `companyName`, leave `contactPersonName` null — when ANY of:
- A business-suffix word is part of the noun: **Döner, Cafe, Café, Restoran, Restaurant, AŞ, A.Ş., Ltd, GmbH, Market, Marketi, Otomotiv, Sanayi, Nakliyat, Cam, Tekstil, İnşaat, Mağaza, Mağazası, Tente, Pizza, Burger, Catering, Büfe, Lokanta, Pastane, Fırın, Manav, Kasap, Eczane**
- Context implies a place of business: "şubesi", "müşteri", "firma", "şirket", "markete uğra", "mağazaya git"
- Activity is a B2B verb: teklif, fatura, ödeme, kurulum, montaj, ölçüm, satış, sözleşme, demo — these almost always imply a business counterparty even with a bare first name (e.g., "Çetin'e teklif gönder" → companyName="Çetin", because the activity is B2B)

Treat as PERSON — set `contactPersonName` + `personConfidence > 0.75`, leave `companyName` null — when ALL of:
- The note names a bare first name (Ahmet, Ensar, Ali, Mehmet, Ayşe, Fatma) with NO business suffix
- The activity is interpersonal: görüşme, konuşma, toplantı, kahve, buluşma, arama, mesaj
- No B2B verb (no teklif/fatura/montaj/ölçüm/kurulum context)

If ambiguous — leave both null, drop overall confidence below 0.75. Do NOT guess.

## 4. Turkish suffix stripping for brand names
Strip dative/locative/ablative/instrumental markers from the brand BEFORE returning it:
- "Çetin Döner'e", "Çetin Dönere" → "Çetin Döner"
- "Mara Market'e", "Mara Markete" → "Mara Market"
- "Ensar Döner'den" → "Ensar Döner"
- "Aslan Market'de" → "Aslan Market"
- "Sahin Otomotiv ile" → "Sahin Otomotiv"

Do NOT strip the suffix word itself (Döner, Market, Otomotiv). Strip only the case marker.

## 5b. Habit / goal detection
If the note expresses a PERSONAL HABIT or recurring self-improvement goal the user wants to build — not a one-off errand and not a business task — set that task's `isHabit=true`, `type="custom"`, `companyName=null`, `contactPersonName=null`, and leave `dueDate`/`dueTime`/`reminderRule` null. Signals (any language): "... istiyorum" / "başlamak istiyorum" / "alışkanlık" / "düzenli olarak" / "her gün ... yapmak" / "spor yapmak istiyorum" / "kitap okumak istiyorum" / "I want to start ...ing" / "build a habit". Keep the title as the habit itself ("Kitap okumak", "Spor yapmak"). A concrete dated errand ("yarın kitabı teslim et") is NOT a habit.
IMPORTANT: A single habit expressed with filler words is ONE task, not many. "Kitap okumak istiyorum, alışkanlık haline getirmek istiyorum" → exactly ONE task titled "Kitap okumak" (isHabit=true). Never emit a separate task for meta-phrases like "alışkanlık haline getirmek", "düzenli yapmak", "başlamak istiyorum".

## 5. Product catalog matching
When the note implies an offer/quote (`offerData.detected = true`) and mentions products, match each mentioned product against the `productCatalog` list supplied in the user message (case/diacritic-insensitive, partial match allowed). When a catalog product matches: use the catalog `name` verbatim in `offerData.products` and, if the note does not state a price, use the catalog `price`. Products not in the catalog stay as spoken, with price 0 when unknown.

## 6. Reminder rule
- If user dictates an explicit rule ("saat başı hatırlat", "her gün hatırlat", "her 30 dakikada hatırlat") → copy that text verbatim into `reminderRule` in the user's language.
- If user gives a due time but NO rule → set `reminderRule` to "<startTime> dan <dueTime> a kadar saat başı hatırlat" (or the English equivalent) where startTime is dueTime - 5h.
- If no due time at all → `reminderRule` is null.

# WORKED EXAMPLES (memorize these)

INPUT: "Ahmet Döner'e gidip fiyat teklifi al yarın saat 12'de"
OUTPUT (relevant fields):
- tasks[0]: { title: "Fiyat teklifi al", description: "Ahmet Döner'e gidip fiyat teklifi al", companyName: "Ahmet Döner", contactPersonName: null, personConfidence: 0, type: "offers", dueDate: "<tomorrow>", dueTime: "12:00" }

INPUT: "Ensar Döner'e montaja git yarın saat 12'de"
OUTPUT:
- tasks[0]: { title: "Montaja git", description: "Ensar Döner'e montaj için git", companyName: "Ensar Döner", contactPersonName: null, personConfidence: 0, type: "installation", dueDate: "<tomorrow>", dueTime: "12:00" }
- ⚠️ companyName is "Ensar Döner" because of the Döner suffix. NOT "Ensar" as a person. NOT "Montaj" as a phantom company.

INPUT: "Ensar'la görüşmeye gidiyorum yarın saat 14'te"
OUTPUT:
- tasks[0]: { title: "Görüşme", description: "Ensar'la görüşmeye git", companyName: null, contactPersonName: "Ensar", personConfidence: 0.92, type: "custom", dueDate: "<tomorrow>", dueTime: "14:00" }

INPUT: "Mehmet'le toplantı"
OUTPUT:
- tasks[0]: { title: "Toplantı", companyName: null, contactPersonName: "Mehmet", personConfidence: 0.9, type: "custom" }

INPUT: "Aslan Market'e uğra ve sonra Ahmet'le konuş"
OUTPUT (2 tasks):
- tasks[0]: { title: "Uğra", companyName: "Aslan Market", contactPersonName: null, type: "visits" }
- tasks[1]: { title: "Konuş", companyName: null, contactPersonName: "Ahmet", personConfidence: 0.85, type: "calls" }

INPUT: "Sahin Otomotiv ile teklif görüşmesi"
OUTPUT:
- tasks[0]: { title: "Teklif görüşmesi", companyName: "Sahin Otomotiv", type: "offers" }

INPUT: "Çetin'e teklif gönder yarın"
OUTPUT (B2B verb → treat as business even with bare first name):
- tasks[0]: { title: "Teklif gönder", companyName: "Çetin", contactPersonName: null, type: "offers", dueDate: "<tomorrow>" }

INPUT: "Sütlü bir şeyler unutma"
OUTPUT (personal errand, no entity):
- tasks[0]: { title: "Sütlü bir şeyler al", companyName: null, contactPersonName: null, personConfidence: 0, type: "todo" }

INPUT: "Mavi Tent'e ölçüm almaya git pazartesi saat 10'da, saat başı hatırlat"
OUTPUT:
- tasks[0]: { title: "Ölçüm al", companyName: "Mavi Tent", type: "measurements", dueDate: "<next monday>", dueTime: "10:00", reminderRule: "saat başı hatırlat" }

# CHECKLIST BEFORE RETURNING

For every task object verify:
1. Is `companyName` a bare brand without any verb? If not, fix.
2. Did I confuse an activity noun (Montaj, Kurulum, Teklif, Ziyaret) for a brand? If yes, move it to title.
3. Did the note have a business suffix in the noun? If yes, the entity is a company — never `contactPersonName`.
4. Are dueDate and dueTime ISO-formatted?
5. Is the language of free-text fields the same as the user's input?

Return the JSON now.
""";
    var userPrompt = JsonSerializer.Serialize(new
    {
        today,
        appLanguage = language,
        existingCompanies,
        existingModules,
        // Kullanıcının ürün kataloğu: teklif tespit edildiğinde ürün adları bu katalogla
        // eşleştirilir ve fiyat verilmemişse katalog satış fiyatı kullanılır.
        productCatalog = productCatalog.Select(item => new { name = item.Name, price = item.SellingPrice, currency = item.Currency }),
        sourceText,
        requiredJsonShape = new
        {
            detectedLanguage = "tr|en|de|ar|fr|nl",
            company = new { name = "string|null", confidence = "0..1", shouldCreateIfMissing = true },
            modules = new[] { new { name = "Visits", type = "visits", confidence = "0..1", shouldCreateIfMissing = true } },
            tasks = new[] { new { title = "string", description = "string", companyName = "string|null", contactPersonName = "string|null", personConfidence = "0..1", type = "visits", dueDate = "yyyy-MM-dd|null", dueTime = "HH:mm|null", timeWindow = "string|null", priority = "low|medium|high", reminderRule = "string|null", isHabit = false } },
            notes = new[] { "string" },
            offerData = new { detected = true, products = new[] { "string" }, prices = new[] { 0 }, currency = "EUR" },
            documentData = new { detected = false, type = "PDF|null" }
        }
    });

    using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
    request.Content = new StringContent(JsonSerializer.Serialize(new
    {
        model,
        temperature = 0.1,
        response_format = new { type = "json_object" },
        messages = new object[]
        {
            new { role = "system", content = systemPrompt },
            new { role = "user", content = userPrompt }
        }
    }), Encoding.UTF8, "application/json");

    var client = httpClientFactory.CreateClient();
    using var response = await client.SendAsync(request);
    var body = await response.Content.ReadAsStringAsync();
    if (!response.IsSuccessStatusCode)
    {
        throw new InvalidOperationException($"OpenAI request failed with status {(int)response.StatusCode}: {body}");
    }

    var completion = JsonSerializer.Deserialize<ChatCompletionResponse>(body, JsonOptions());
    var content = completion?.Choices.FirstOrDefault()?.Message.Content;
    if (string.IsNullOrWhiteSpace(content))
    {
        throw new InvalidOperationException("OpenAI returned an empty analysis.");
    }

    var analysis = ParseAiAnalysisContent(content);
    return NormalizeAiAnalysis(analysis, sourceText, today);
}

static async Task<IResult> AnswerAssistant(
    ClaimsPrincipal principal,
    AssistantAskRequest request,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory)
{
    var question = request?.Question?.Trim();
    if (string.IsNullOrWhiteSpace(question))
    {
        return Results.BadRequest(new { message = "Question is required." });
    }

    var apiKey = configuration["OpenAI:ApiKey"];
    if (string.IsNullOrWhiteSpace(apiKey))
    {
        // No key — let the client fall back to its offline keyword summary.
        return Results.Problem("Assistant is not configured.", statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    var userId = principal.UserId();
    var language = string.IsNullOrWhiteSpace(request!.Language) ? "tr" : request.Language!.Trim();
    var now = DateTimeOffset.Now;

    var companies = await db.Companies.Where(item => item.UserId == userId).ToListAsync();
    var companyById = companies
        .GroupBy(item => item.Id)
        .ToDictionary(group => group.Key, group => group.First().Name);
    var tasks = await db.Tasks.Where(item => item.UserId == userId).ToListAsync();
    var offers = await db.Offers.Where(item => item.UserId == userId).ToListAsync();
    var invoices = await db.Invoices.Where(item => item.UserId == userId).ToListAsync();

    string? CompanyName(string? companyId) =>
        !string.IsNullOrWhiteSpace(companyId) && companyById.TryGetValue(companyId!, out var name) ? name : null;

    var openTasks = tasks.Where(item => !string.Equals(item.Status, "done", StringComparison.OrdinalIgnoreCase)).ToList();
    var overdue = openTasks.Where(item =>
    {
        var due = ParseTaskDueAt(item);
        return due is not null && due.Value < now;
    }).ToList();
    var unpaidInvoices = invoices.Where(item => !string.Equals(item.Status, "paid", StringComparison.OrdinalIgnoreCase)).ToList();
    var openOffers = offers.Where(item => item.Status is "sent" or "draft" or "prepared").ToList();

    var snapshot = new
    {
        today = AppTime.UserToday(now).ToString("yyyy-MM-dd"),
        counts = new
        {
            companies = companies.Count,
            openTasks = openTasks.Count,
            overdueTasks = overdue.Count,
            unpaidInvoices = unpaidInvoices.Count,
            openOffers = openOffers.Count
        },
        unpaidInvoiceTotal = unpaidInvoices.Sum(item => item.Total),
        openTasksList = openTasks
            .OrderBy(item => item.DueDate ?? "9999")
            .Take(40)
            .Select(item => new { title = item.Title, company = CompanyName(item.CompanyId), due = item.DueDate, time = item.DueTime, status = GetEffectiveTaskStatus(item, now) }),
        companiesList = companies.Take(80).Select(item => item.Name),
        unpaidInvoicesList = unpaidInvoices
            .Take(30)
            .Select(item => new { number = item.InvoiceNumber, company = CompanyName(item.CompanyId), total = item.Total, due = item.DueDate, status = item.Status }),
        offersList = offers
            .Take(30)
            .Select(item => new { number = item.OfferNumber, company = CompanyName(item.CompanyId), title = item.Title, total = item.Total, currency = item.Currency, status = item.Status })
    };

    var systemPrompt =
        "Sen \"ArX Task\" adlı saha satış ve görev yönetimi uygulamasının yapay zekâ asistanısın. " +
        "Sana JSON formatında kullanıcının güncel iş verisi (görevler, firmalar, teklifler, faturalar) verilecek. " +
        "Kullanıcının sorusunu YALNIZCA bu veriye dayanarak kısa, net ve yardımcı biçimde yanıtla. " +
        "Veride olmayan bir bilgiyi uydurma; ilgili bilgi yoksa bunu nazikçe belirt. " +
        "Tutarları ve tarihleri veride verildiği gibi kullan. " +
        $"Yanıtı şu dilde ver: {language}.";

    var userPrompt = $"SORU:\n{question}\n\nGÜNCEL VERİ (JSON):\n{JsonSerializer.Serialize(snapshot)}";

    var model = configuration["OpenAI:ChatModel"] ?? "gpt-4o-mini";
    try
    {
        using var openAiRequest = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
        openAiRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        openAiRequest.Content = new StringContent(JsonSerializer.Serialize(new
        {
            model,
            temperature = 0.3,
            messages = new object[]
            {
                new { role = "system", content = systemPrompt },
                new { role = "user", content = userPrompt }
            }
        }), Encoding.UTF8, "application/json");

        var client = httpClientFactory.CreateClient();
        using var response = await client.SendAsync(openAiRequest);
        var body = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
        {
            return Results.Problem("Assistant request failed.", statusCode: StatusCodes.Status502BadGateway);
        }

        var completion = JsonSerializer.Deserialize<ChatCompletionResponse>(body, JsonOptions());
        var answer = completion?.Choices.FirstOrDefault()?.Message.Content?.Trim();
        if (string.IsNullOrWhiteSpace(answer))
        {
            return Results.Problem("Assistant returned an empty answer.", statusCode: StatusCodes.Status502BadGateway);
        }

        return Results.Ok(new { answer });
    }
    catch
    {
        return Results.Problem("Assistant request failed.", statusCode: StatusCodes.Status502BadGateway);
    }
}

static async Task<AiCreatedRecords> CommitAiAnalysis(string userId, AiCaptureAnalyzeRequest request, AiCaptureAnalysis analysis, ArxTaskDbContext db)
{
    CompanyEntity? company = null;
    var requestDrafts = new List<AiCompanyDraftRequest>();
    if (request.CompanyDraft is not null)
    {
        requestDrafts.Add(request.CompanyDraft);
    }

    if (request.CompanyDrafts is not null)
    {
        requestDrafts.AddRange(request.CompanyDrafts);
    }

    var requestedCompanyDraft = requestDrafts.FirstOrDefault();
    var companyName = NormalizeInferredCompanyCandidate(requestedCompanyDraft?.Name);
    if (string.IsNullOrWhiteSpace(companyName))
    {
        // Prefer the model's company name (already resolved in NormalizeAiAnalysis); use
        // regex inference only as a fallback when the model gave none.
        companyName = NormalizeInferredCompanyCandidate(analysis.Company.Name) ?? InferCompanyNames(request.SourceText).FirstOrDefault();
    }
    var companyDomain = ExtractDomainFromSourceText(request.SourceText);
    var shouldResolveCompany =
        (!string.IsNullOrWhiteSpace(companyName) && analysis.Company.Confidence >= 0.75) ||
        !string.IsNullOrWhiteSpace(companyDomain) ||
        !string.IsNullOrWhiteSpace(request.CompanyResolution?.ExistingCompanyId) ||
        requestDrafts.Count > 0;

    if (shouldResolveCompany)
    {
        var matchingCompanies = await FindMatchingCompanies(db, userId, companyName, request.SourceText);
        if (!string.IsNullOrWhiteSpace(request.CompanyResolution?.ExistingCompanyId))
        {
            company = await db.Companies.FirstOrDefaultAsync(item =>
                item.UserId == userId &&
                item.Id == request.CompanyResolution.ExistingCompanyId);

            if (company is null)
            {
                throw new InvalidOperationException("Selected company record could not be found.");
            }
        }
        else if (request.CompanyResolution?.CreateSeparateCompany == true)
        {
            company = null;
        }
        else
        {
            company = matchingCompanies.FirstOrDefault();
            // If the parsed candidate didn't match anything but the source text
            // explicitly mentions an existing firm, bind to that firm rather
            // than creating a brand-new noisy entry like
            // "Bu Çetin Döner'e İş Görüşmesin".
            if (company is null)
            {
                company = await FindExistingCompanyByMention(db, userId, companyName, request.SourceText);
            }
        }

        MergeCompanyDraftIntoExisting(company, requestedCompanyDraft);

        if (company is null && (!string.IsNullOrWhiteSpace(companyName) || requestedCompanyDraft is not null))
        {
            company = new CompanyEntity
            {
                Id = NewId("company"),
                UserId = userId,
                Name = requestedCompanyDraft?.Name?.Trim() ?? companyName ?? "Yeni firma",
                Address = requestedCompanyDraft?.Address?.Trim() ?? "",
                Phone = requestedCompanyDraft?.Phone?.Trim() ?? "",
                Email = requestedCompanyDraft?.Email?.Trim() ?? "",
                ContactPerson = requestedCompanyDraft?.ContactPerson?.Trim() ?? "",
                Latitude = 0,
                Longitude = 0,
                Status = "new",
                Tags = "AI-created",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            };
            db.Companies.Add(company);
        }
    }

    var noteContent = BuildAiNoteContent(request.SourceText, analysis);
    var createdTaskIds = new List<string>();
    var createdReminderIds = new List<string>();
    var createdModuleIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    var habitTaskIds = new List<string>();
    string? offerId = null;
    string? invoiceId = null;
    string? firstResolvedCompanyId = company?.Id;
    var companyCache = new Dictionary<string, CompanyEntity?>(StringComparer.OrdinalIgnoreCase);
    var tasksToCommit = analysis.Tasks.Count > 0
        ? analysis.Tasks
        : [new AiTask("Business follow-up", request.SourceText, "todo", DateOnly.FromDateTime(DateTime.Now).ToString("yyyy-MM-dd"), null, null, "medium", null, null)];

    bool IsPrimaryCompanyName(string? candidateName)
    {
        var normalizedPrimary = NormalizeCompanyLookup(companyName);
        var normalizedCandidate = NormalizeCompanyLookup(candidateName);
        return !string.IsNullOrWhiteSpace(normalizedPrimary) &&
               !string.IsNullOrWhiteSpace(normalizedCandidate) &&
               string.Equals(normalizedPrimary, normalizedCandidate, StringComparison.Ordinal);
    }

    AiCompanyDraftRequest? FindDraftForCompanyName(string? candidateName)
    {
        var normalizedCandidate = NormalizeCompanyLookup(candidateName);
        if (string.IsNullOrWhiteSpace(normalizedCandidate))
        {
            return null;
        }

        return requestDrafts.FirstOrDefault(item =>
        {
            var detectedName = NormalizeCompanyLookup(item.DetectedName);
            var draftName = NormalizeCompanyLookup(item.Name);
            return (!string.IsNullOrWhiteSpace(detectedName) && string.Equals(detectedName, normalizedCandidate, StringComparison.Ordinal)) ||
                   (!string.IsNullOrWhiteSpace(draftName) && string.Equals(draftName, normalizedCandidate, StringComparison.Ordinal));
        });
    }

    static bool HasMeaningfulCompanyDetails(AiCompanyDraftRequest? draft)
    {
        return draft is not null &&
               (!string.IsNullOrWhiteSpace(draft.Address) ||
                !string.IsNullOrWhiteSpace(draft.Phone) ||
                !string.IsNullOrWhiteSpace(draft.Email) ||
                !string.IsNullOrWhiteSpace(draft.ContactPerson));
    }

    static void MergeCompanyDraftIntoExisting(CompanyEntity? target, AiCompanyDraftRequest? draft)
    {
        if (target is null || !HasMeaningfulCompanyDetails(draft))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(target.Address) && !string.IsNullOrWhiteSpace(draft!.Address))
        {
            target.Address = draft.Address.Trim();
        }

        if (string.IsNullOrWhiteSpace(target.Phone) && !string.IsNullOrWhiteSpace(draft!.Phone))
        {
            target.Phone = draft.Phone.Trim();
        }

        if (string.IsNullOrWhiteSpace(target.Email) && !string.IsNullOrWhiteSpace(draft!.Email))
        {
            target.Email = draft.Email.Trim();
        }

        if (string.IsNullOrWhiteSpace(target.ContactPerson) && !string.IsNullOrWhiteSpace(draft!.ContactPerson))
        {
            target.ContactPerson = draft.ContactPerson.Trim();
        }

        target.UpdatedAt = DateTimeOffset.UtcNow;
    }

    string? ResolveTaskCompanyHint(AiTask parsedTask)
    {
        var inferredTaskCompanyName = NormalizeInferredCompanyCandidate(parsedTask.CompanyName);
        if (string.IsNullOrWhiteSpace(inferredTaskCompanyName))
        {
            inferredTaskCompanyName = InferCompanyNames($"{parsedTask.Title} {parsedTask.Description}").FirstOrDefault();
        }

        if (string.IsNullOrWhiteSpace(inferredTaskCompanyName) && tasksToCommit.Count == 1)
        {
            inferredTaskCompanyName = companyName;
        }

        return NormalizeInferredCompanyCandidate(inferredTaskCompanyName);
    }

    async Task<CompanyEntity?> ResolveTaskCompany(AiTask parsedTask)
    {
        var inferredTaskCompanyName = ResolveTaskCompanyHint(parsedTask);

        if (string.IsNullOrWhiteSpace(inferredTaskCompanyName))
        {
            return null;
        }

        if (IsPrimaryCompanyName(inferredTaskCompanyName))
        {
            return company;
        }

        if (companyCache.TryGetValue(inferredTaskCompanyName, out var cachedCompany))
        {
            return cachedCompany;
        }

        var matchingDraft = FindDraftForCompanyName(inferredTaskCompanyName);
        var sourceContext = $"{parsedTask.Title} {parsedTask.Description} {request.SourceText}";
        var matchingCompanies = await FindMatchingCompanies(db, userId, inferredTaskCompanyName, sourceContext);
        var resolvedCompany = matchingCompanies.FirstOrDefault();

        // Last-mile safety: if our regex/AI produced a noisy candidate ("Bu
        // Çetin Döner'e İş Görüşmesin") but the source text mentions an
        // existing firm verbatim ("Çetin Döner"), bind to that firm instead
        // of creating a new one.
        if (resolvedCompany is null)
        {
            var mentioned = await FindExistingCompanyByMention(db, userId, inferredTaskCompanyName, sourceContext);
            if (mentioned is not null)
            {
                resolvedCompany = mentioned;
            }
        }

        MergeCompanyDraftIntoExisting(resolvedCompany, matchingDraft);

        if (resolvedCompany is null)
        {
            resolvedCompany = new CompanyEntity
            {
                Id = NewId("company"),
                UserId = userId,
                Name = matchingDraft?.Name?.Trim() ?? inferredTaskCompanyName,
                Address = matchingDraft?.Address?.Trim() ?? "",
                Phone = matchingDraft?.Phone?.Trim() ?? "",
                Email = matchingDraft?.Email?.Trim() ?? "",
                ContactPerson = matchingDraft?.ContactPerson?.Trim() ?? "",
                Latitude = 0,
                Longitude = 0,
                Status = "new",
                Tags = "AI-created",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            };
            db.Companies.Add(resolvedCompany);
        }

        companyCache[inferredTaskCompanyName] = resolvedCompany;
        return resolvedCompany;
    }

    foreach (var parsedTask in tasksToCommit)
    {
        var taskCompanyHint = ResolveTaskCompanyHint(parsedTask);

        // AI net şekilde "kişi" dediyse (örn. "Ensar'la görüşme" → contactPersonName="Ensar",
        // personConfidence>0.75) firma çözümlemesini ve adres modalını tamamen atla.
        var hasConfidentPerson = !string.IsNullOrWhiteSpace(parsedTask.ContactPersonName)
                                 && parsedTask.PersonConfidence > 0.75;
        // Alışkanlık hedefleri her zaman kişiseldir — firma/teklif çözümlemesine girmez.
        var isPersonal = parsedTask.IsHabit
                         || hasConfidentPerson
                         || ShouldTreatTaskAsPersonal(parsedTask, !string.IsNullOrWhiteSpace(taskCompanyHint));
        var taskCompany = isPersonal ? null : await ResolveTaskCompany(parsedTask);
        firstResolvedCompanyId ??= taskCompany?.Id;
        var resolvedModules = await ResolveModulesForAiTask(db, userId, analysis, parsedTask, isPersonal, request.Language);
        foreach (var resolvedModule in resolvedModules)
        {
            createdModuleIds.Add(resolvedModule.Id);
        }

        var taskType = isPersonal ? "custom" : ExistingModuleType(parsedTask.Type);
        var duplicate = await FindExistingOpenTaskForAiCommit(db, userId, parsedTask, taskCompany);

        var task = duplicate ?? new BusinessTaskEntity
        {
            Id = NewId("task"),
            UserId = userId,
            CompanyId = taskCompany?.Id,
            CreatedAt = DateTimeOffset.UtcNow,
            CompletedAt = null
        };
        task.Title = parsedTask.Title;
        task.Description = string.IsNullOrWhiteSpace(parsedTask.Description) ? request.SourceText : parsedTask.Description;
        task.Type = taskType;
        task.ModuleIds = string.Join(",", resolvedModules.Select(item => item.Id).Distinct());
        task.DueDate = parsedTask.DueDate;
        task.DueTime = parsedTask.DueTime;
        task.TimeWindow = parsedTask.TimeWindow;
        task.ReminderInterval = parsedTask.ReminderRule;
        task.RepeatUntilDone = !string.IsNullOrWhiteSpace(parsedTask.ReminderRule);
        task.Status = "open";
        task.Priority = NormalizePriority(parsedTask.Priority);
        task.NotificationsEnabled = true;
        // Kişi adı yalnızca firma olmadığında (gerçek kişisel görev) task'a düşer.
        task.ContactPersonName = taskCompany is null && !string.IsNullOrWhiteSpace(parsedTask.ContactPersonName)
            ? parsedTask.ContactPersonName!.Trim()
            : null;
        if (parsedTask.IsHabit)
        {
            // Alışkanlık: tarihsiz başlar, "planning" aşamasında 2-3 günde bir dürtülür.
            task.IsHabit = true;
            task.HabitStage = "planning";
            task.Type = "custom";
            task.DueDate = null;
            task.DueTime = null;
            task.TimeWindow = null;
            task.ReminderInterval = null;
            task.RepeatUntilDone = false;
            if (task.NudgeIntervalDays <= 0) task.NudgeIntervalDays = 2;
            habitTaskIds.Add(task.Id);
        }
        if (duplicate is null)
        {
            db.Tasks.Add(task);
        }

        db.Notes.Add(new NoteEntity
        {
            Id = NewId("note"),
            UserId = userId,
            CompanyId = taskCompany?.Id,
            TaskId = task.Id,
            Content = noteContent,
            SourceType = request.SourceType is "voice" or "text" ? request.SourceType : "text",
            SourceTranscript = request.SourceText,
            CreatedAt = DateTimeOffset.UtcNow
        });

        ReminderEntity? reminder = null;
        if (!string.IsNullOrWhiteSpace(parsedTask.ReminderRule))
        {
            reminder = db.Reminders.Local.FirstOrDefault(item => item.UserId == userId && item.TaskId == task.Id)
                ?? await db.Reminders.FirstOrDefaultAsync(item => item.UserId == userId && item.TaskId == task.Id)
                ?? new ReminderEntity
                {
                    Id = NewId("reminder"),
                    UserId = userId,
                    TaskId = task.Id,
                };
            reminder.TaskId = task.Id;
            reminder.StartTime = ReminderStartTime(parsedTask);
            reminder.RepeatInterval = parsedTask.ReminderRule;
            reminder.ActiveUntilDone = true;
            reminder.Status = "active";
            reminder.NotificationsEnabled = true;
            if (db.Entry(reminder).State == EntityState.Detached)
            {
                db.Reminders.Add(reminder);
            }
            createdReminderIds.Add(reminder.Id);
        }

        if (offerId is null && taskCompany is not null && ShouldCreateOfferDraft(analysis, parsedTask, tasksToCommit.Count))
        {
            var offer = await CreateAiOfferDraft(db, userId, taskCompany, task, analysis);
            offerId = offer.Id;
            db.Timeline.Add(Timeline(userId, taskCompany.Id, "offer", "AI created draft offer", offer.OfferNumber, offer.Id));
        }

        if (invoiceId is null && taskCompany is not null && ShouldCreateInvoiceDraftForTask(parsedTask, tasksToCommit.Count))
        {
            var invoice = await CreateAiInvoiceDraft(db, userId, taskCompany, task, analysis);
            invoiceId = invoice.Id;
            db.Timeline.Add(Timeline(userId, taskCompany.Id, "invoice", "AI created draft invoice", invoice.InvoiceNumber, invoice.Id));
        }

        if (taskCompany is not null)
        {
            db.Timeline.Add(Timeline(userId, taskCompany.Id, "ai-capture", "AI created task", noteContent, task.Id));
        }

        await SyncTaskAlertsForTask(db, userId, task, reminder);
        createdTaskIds.Add(task.Id);
    }

    await db.SaveChangesAsync();

    // Alışkanlık görevleri için ilk "ne zaman başlayalım?" dürtmesini planla.
    foreach (var habitId in habitTaskIds)
    {
        var habit = await db.Tasks.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == habitId);
        if (habit is not null) HabitScheduler.ScheduleNudge(habit, TimeSpan.FromDays(Math.Max(1, habit.NudgeIntervalDays)));
    }
    if (habitTaskIds.Count > 0) await db.SaveChangesAsync();

    return new AiCreatedRecords(company?.Id ?? firstResolvedCompanyId, createdTaskIds, createdModuleIds.ToList(), createdReminderIds, offerId, invoiceId);
}

static async Task<AiCompanyResolutionPrompt?> BuildCompanyResolutionPrompt(ArxTaskDbContext db, string userId, AiCaptureAnalysis analysis, string sourceText)
{
    // Prefer the model's company name; fall back to regex inference only when it gave none.
    var companyName = NormalizeInferredCompanyCandidate(analysis.Company.Name)
        ?? NormalizeInferredCompanyCandidate(InferCompanyNames(sourceText).FirstOrDefault());
    var companyDomain = ExtractDomainFromSourceText(sourceText);

    // Robustness: if the parsed candidate is noisy (e.g. "Bu Çetin Döner'e İş
    // Görüşmesin") but the source mentions an existing firm by name, swap to
    // that firm. This is the cheapest, most reliable bind: explicit verbatim
    // mention of an existing company always wins.
    var mentionedCompany = await FindExistingCompanyByMention(db, userId, companyName, sourceText);
    if (mentionedCompany is not null)
    {
        companyName = mentionedCompany.Name;
    }

    if ((string.IsNullOrWhiteSpace(companyName) || analysis.Company.Confidence < 0.75) && string.IsNullOrWhiteSpace(companyDomain) && mentionedCompany is null)
    {
        return null;
    }

    var matches = await FindMatchingCompanies(db, userId, companyName, sourceText);

    if (matches.Count == 0)
    {
        return null;
    }

    // Auto-bind when there is exactly one existing company whose name matches
    // the spoken / written name exactly (normalised). Returning null here lets
    // CommitAiAnalysis pick `matches.FirstOrDefault()` automatically, with no
    // "is this the same company?" prompt to the user.
    // Auto-bind (no prompt) when the single match is the SAME company beyond doubt —
    // i.e. exact or diacritic-only difference ("Ensar Döner" vs "Ensar Doner"). Genuine
    // fuzzy near-matches (tier 1) fall through below and are surfaced for the user to
    // confirm rather than silently binding or creating a duplicate.
    if (matches.Count == 1 && IsDefiniteCompanyMatch(companyName, matches[0].Name))
    {
        return null;
    }

    var taskCounts = await db.Tasks
        .Where(item => item.UserId == userId && matches.Select(company => company.Id).Contains(item.CompanyId!))
        .GroupBy(item => item.CompanyId!)
        .Select(group => new { CompanyId = group.Key, Count = group.Count() })
        .ToDictionaryAsync(item => item.CompanyId, item => item.Count);

    var candidates = matches.Select(item => new AiCompanyResolutionCandidate(
        item.Id,
        item.Name,
        item.Address,
        taskCounts.GetValueOrDefault(item.Id, 0),
        item.CreatedAt.ToString("O"),
        item.Latitude == 0 ? null : item.Latitude,
        item.Longitude == 0 ? null : item.Longitude)).ToList();

    companyName ??= companyDomain;
    var message = matches.Count == 1
        ? $"'{companyName}' adında mevcut bir firma kaydı bulundu. Yeni görevi mevcut firma altında mı tutalım, yoksa ayrı yeni bir kayıt mı açalım?"
        : $"'{companyName}' adına ait {matches.Count} mevcut firma kaydı bulundu. Lütfen görevin hangi firma kaydına bağlanacağını seçin veya ayrı yeni bir kayıt açın.";

    return new AiCompanyResolutionPrompt(companyName ?? "firma", candidates, message);
}

static List<string> CollectDetectedCompanyNames(AiCaptureAnalysis analysis, string sourceText)
{
    var detectedNames = new List<string>();

    void AddName(string? value)
    {
        var sanitizedValue = NormalizeInferredCompanyCandidate(value);
        var normalizedValue = NormalizeCompanyLookup(sanitizedValue);
        if (string.IsNullOrWhiteSpace(normalizedValue))
        {
            return;
        }

        if (detectedNames.Any(existing => NormalizeCompanyLookup(existing) == normalizedValue))
        {
            return;
        }

        detectedNames.Add(sanitizedValue!.Trim());
    }

    foreach (var task in analysis.Tasks)
    {
        // AI net şekilde kişi adı verdiyse (Ensar gibi), bu görevi firma çözümleme
        // ve adres çözümleme akışlarından tamamen çıkar — kişi için firma sorulmaz.
        if (!string.IsNullOrWhiteSpace(task.ContactPersonName) && task.PersonConfidence > 0.75)
        {
            continue;
        }
        var hasTaskCompany = !string.IsNullOrWhiteSpace(task.CompanyName);
        AddName(task.CompanyName);
        if (hasTaskCompany)
        {
            // Trust AI's task.CompanyName. Running regex inference on title+description
            // would produce phantom names like "Ölçü Almak Mavi Tent" by gluing the
            // task verb to the firm name.
            continue;
        }

        foreach (var inferredName in InferCompanyNames($"{task.Title} {task.Description}"))
        {
            AddName(inferredName);
        }
    }

    if (detectedNames.Count == 0)
    {
        foreach (var inferredName in InferCompanyNames(sourceText))
        {
            AddName(inferredName);
        }
    }

    if (detectedNames.Count == 0 && analysis.Company.Confidence >= 0.75)
    {
        AddName(analysis.Company.Name);
    }

    // Substring dedupe — eğer iki ad birinin diğerini içeriyorsa kısa olanı tut.
    // Örnek: "Ahmet Döner" listede + "Fiyat Teklifi Al Ahmet Döner" hayalet ise
    // uzun olan atılır. Bu, regex inference'in eylem ifadesini brand'e yapıştırdığı
    // durumları yakalar.
    if (detectedNames.Count > 1)
    {
        var kept = new List<string>();
        foreach (var name in detectedNames.OrderBy(n => NormalizeCompanyLookup(n).Length))
        {
            var normalized = NormalizeCompanyLookup(name);
            var swallowsShorter = kept.Any(existing =>
            {
                var existingNorm = NormalizeCompanyLookup(existing);
                return normalized != existingNorm && normalized.Contains(existingNorm, StringComparison.OrdinalIgnoreCase);
            });
            if (!swallowsShorter) kept.Add(name);
        }
        return kept;
    }

    return detectedNames;
}

static async Task<List<AiCompanyAddressPrompt>> BuildCompanyAddressPrompts(
    ArxTaskDbContext db,
    string userId,
    AiCaptureAnalysis analysis,
    string sourceText,
    AiCompanyResolutionRequest? companyResolution,
    List<AiCompanyDraftRequest>? companyDrafts,
    AiCompanyDraftRequest? companyDraft)
{
    if (!string.IsNullOrWhiteSpace(companyResolution?.ExistingCompanyId))
    {
        return [];
    }

    var suppliedDrafts = new List<AiCompanyDraftRequest>();
    if (companyDraft is not null)
    {
        suppliedDrafts.Add(companyDraft);
    }

    if (companyDrafts is not null)
    {
        suppliedDrafts.AddRange(companyDrafts);
    }

    var suppliedDraftNames = suppliedDrafts
        .SelectMany(item => new[] { item.DetectedName, item.Name })
        .Select(NormalizeCompanyLookup)
        .Where(item => !string.IsNullOrWhiteSpace(item))
        .ToHashSet(StringComparer.Ordinal);

    var prompts = new List<AiCompanyAddressPrompt>();
    foreach (var detectedName in CollectDetectedCompanyNames(analysis, sourceText))
    {
        var sanitizedDetectedName = NormalizeInferredCompanyCandidate(detectedName);
        var normalizedDetectedName = NormalizeCompanyLookup(sanitizedDetectedName);
        if (string.IsNullOrWhiteSpace(normalizedDetectedName) || suppliedDraftNames.Contains(normalizedDetectedName))
        {
            continue;
        }

        // If the noisy detected phrase actually contains an existing firm's
        // name (e.g. "Bu Çetin Döner'e İş Görüşmesin" contains "Çetin Döner"),
        // don't prompt for a brand-new firm. The task will bind to the
        // existing record downstream.
        var mentioned = await FindExistingCompanyByMention(db, userId, sanitizedDetectedName, sourceText);
        if (mentioned is not null)
        {
            continue;
        }

        var matches = await FindMatchingCompanies(db, userId, sanitizedDetectedName, sourceText);
        if (matches.Count > 0)
        {
            var exactMatchWithMissingAddress = matches.FirstOrDefault(item =>
                NormalizeCompanyLookup(item.Name) == normalizedDetectedName &&
                string.IsNullOrWhiteSpace(item.Address));

            if (exactMatchWithMissingAddress is null)
            {
                continue;
            }

            prompts.Add(new AiCompanyAddressPrompt(
                sanitizedDetectedName!,
                $"'{sanitizedDetectedName}' sistemde kayitli ancak adres bilgisi eksik. Bu firma icin adresi girin; isterseniz telefon ve kisi bilgilerini de tamamlayabilirsiniz."));
            continue;
        }

        prompts.Add(new AiCompanyAddressPrompt(
            sanitizedDetectedName!,
            $"'{sanitizedDetectedName}' sistemde kayitli degil. Bu firmayi olusturmak icin adresini girin. Telefon ve kisi bilgilerini isterseniz simdi ekleyebilirsiniz."));
    }

    return prompts;
}

static async Task<IResult> CommitParsedCapture(ClaimsPrincipal principal, ParsedCommitRequest request, ArxTaskDbContext db, IConfiguration configuration, IHttpClientFactory httpClientFactory)
{
    var userId = principal.UserId();
    var companyName = request.CompanyName?.Trim();
    if (string.IsNullOrWhiteSpace(companyName))
    {
        return Results.BadRequest(new { message = "Company is required." });
    }

    var normalizedCompanyName = NormalizeCompanyLookup(companyName);
    var company = (await db.Companies
        .Where(item => item.UserId == userId)
        .ToListAsync())
        .FirstOrDefault(item => NormalizeCompanyLookup(item.Name) == normalizedCompanyName);
    if (company is null)
    {
        company = new CompanyEntity
        {
            Id = NewId("company"),
            UserId = userId,
            Name = companyName,
            Address = "",
            Phone = "",
            Email = "",
            ContactPerson = "",
            Latitude = 0,
            Longitude = 0,
            Status = "new",
            Tags = "AI-created",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };
        db.Companies.Add(company);
    }

    var moduleIds = new List<string>();
    foreach (var moduleName in request.ModuleNames.Distinct(StringComparer.OrdinalIgnoreCase))
    {
        var slug = Slug(moduleName);
        var module = await db.Modules.FirstOrDefaultAsync(item => item.UserId == userId && (item.Id == $"module-{slug}" || item.Name.ToLower() == moduleName.ToLower()));
        if (module is null)
        {
            module = new WorkModuleEntity
            {
                Id = $"module-{slug}",
                UserId = userId,
                Name = moduleName,
                Type = moduleName.Equals("Measurements", StringComparison.OrdinalIgnoreCase) ? "measurements" : "custom",
                CreatedByAI = true,
                IsPinnedToSidebar = true,
                TaskCount = 0,
                CreatedAt = DateTimeOffset.UtcNow
            };
            db.Modules.Add(module);
        }
        moduleIds.Add(module.Id);
    }

    var task = new BusinessTaskEntity
    {
        Id = NewId("task"),
        UserId = userId,
        CompanyId = company.Id,
        Title = request.TaskTitle,
        Description = request.SourceText,
        Type = request.TaskType,
        ModuleIds = string.Join(",", moduleIds),
        DueDate = request.DueDate,
        DueTime = request.DueTime,
        TimeWindow = request.TimeWindow,
        ReminderInterval = request.ReminderRule,
        RepeatUntilDone = !string.IsNullOrWhiteSpace(request.ReminderRule),
        Status = "open",
        Priority = request.Priority,
        NotificationsEnabled = true,
        CreatedAt = DateTimeOffset.UtcNow,
        CompletedAt = null
    };
    db.Tasks.Add(task);

    db.Notes.Add(new NoteEntity
    {
        Id = NewId("note"),
        UserId = userId,
        CompanyId = company.Id,
        TaskId = task.Id,
        Content = request.SourceText,
        SourceType = "voice",
        SourceTranscript = request.SourceText,
        CreatedAt = DateTimeOffset.UtcNow
    });

    ReminderEntity? reminder = null;
    if (!string.IsNullOrWhiteSpace(request.ReminderRule))
    {
        reminder = new ReminderEntity
        {
            Id = NewId("reminder"),
            UserId = userId,
            TaskId = task.Id,
            StartTime = request.DueDate ?? DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"),
            RepeatInterval = request.ReminderRule,
            ActiveUntilDone = true,
            Status = "active",
            NotificationsEnabled = true
        };
        db.Reminders.Add(reminder);
    }

    db.Timeline.Add(Timeline(userId, company.Id, "ai-capture", "AI capture created task", request.SourceText, task.Id));
    await SyncTaskAlertsForTask(db, userId, task, reminder);
    await db.SaveChangesAsync();
    await GeocodePendingCompanies(db, userId, configuration, httpClientFactory);
    return Results.Ok(await BuildSnapshot(db, userId));
}

// AI akışlarında oluşturulan/adres kazanan ama koordinatı olmayan firmaları geocode eder.
static async Task GeocodePendingCompanies(ArxTaskDbContext db, string userId, IConfiguration configuration, IHttpClientFactory httpClientFactory)
{
    var pending = await db.Companies
        .Where(item => item.UserId == userId && item.Address != "" && item.Latitude == 0 && item.Longitude == 0 && !item.AddressVerified)
        .Take(3)
        .ToListAsync();
    if (pending.Count == 0) return;
    var first = true;
    foreach (var company in pending)
    {
        // Nominatim kullanım politikası: ardışık isteklerde ~1 sn aralık bırak.
        if (!first) await Task.Delay(1100);
        first = false;
        await GeocodeCompanyAsync(company, configuration, httpClientFactory);
    }
    await db.SaveChangesAsync();
}

static AiCaptureAnalysis NormalizeAiAnalysis(AiCaptureAnalysis analysis, string sourceText, string today)
{
    var language = NormalizeLanguage(analysis.DetectedLanguage);
    var company = analysis.Company is { Name: { } existingCompanyName } existingCompany
        ? existingCompany with { Name = NormalizeInferredCompanyCandidate(existingCompanyName) ?? existingCompanyName.Trim() }
        : analysis.Company ?? new AiCompany(null, 0, false);
    var inferredCompanyNames = InferCompanyNames(sourceText)
        .Select(item => NormalizeInferredCompanyCandidate(item))
        .Where(item => !string.IsNullOrWhiteSpace(item) && LooksLikeMeaningfulCompanyName(item))
        .Select(item => item!)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToList();
    var inferredCompanyName = inferredCompanyNames.FirstOrDefault();
    // Trust the LLM's own company decision as PRIMARY — the system prompt is heavily
    // engineered for brand-vs-action separation. Regex inference is only a FALLBACK for
    // when the model produced no company at all. Previously this block unconditionally
    // REPLACED the model's careful choice with a regex token and pinned confidence to
    // 0.92, which is exactly how an unrelated word ("Servis", "Depoyu Kontrol ...")
    // became a phantom company. We no longer discard the model's name.
    var llmCompanyName = string.IsNullOrWhiteSpace(company.Name) ? null : company.Name.Trim();
    var resolvedCompanyName = llmCompanyName ?? inferredCompanyName;
    if (!string.IsNullOrWhiteSpace(resolvedCompanyName))
    {
        // Keep the model's own confidence when it named the company; floor it only enough
        // that existing-company matching/resolution still runs (matching prevents
        // duplicates and the fuzzy layer surfaces near-misses for the user to confirm).
        var confidence = llmCompanyName is not null ? Math.Max(company.Confidence, 0.8) : 0.8;
        company = new AiCompany(resolvedCompanyName, confidence, true);
    }

    var inferredDate = InferDueDate(sourceText, today);
    var inferredTimeWindow = InferTimeWindow(sourceText);
    var inferredTime = InferDueTime(sourceText, inferredTimeWindow);
    var inputModules = analysis.Modules ?? [];
    var inputTasks = analysis.Tasks ?? [];
    var modules = inputModules.Count > 0 ? inputModules : [new AiModule("To Do", "todo", 0.7, false)];
    var tasks = inputTasks.Count > 0
        ? inputTasks
        : [new AiTask("Business follow-up", sourceText, "todo", today, null, null, "medium", null, null)];
    var sourceSegments = SplitCompanyInferenceSegments(sourceText).ToList();
    var segmentCompanyNames = sourceSegments
        .Select(segment => InferCompanyNames(segment)
            .Select(item => NormalizeInferredCompanyCandidate(item))
            .FirstOrDefault(item => !string.IsNullOrWhiteSpace(item) && LooksLikeMeaningfulCompanyName(item)))
        .ToList();

    return analysis with
    {
        DetectedLanguage = language,
        Company = company with
        {
            Name = string.IsNullOrWhiteSpace(company.Name) ? null : company.Name.Trim(),
            Confidence = Clamp(company.Confidence)
        },
        Modules = modules
            .Where(item => !string.IsNullOrWhiteSpace(item.Name))
            .Select(item => item with
            {
                Name = item.Name.Trim(),
                Type = ExistingModuleType(item.Type),
                Confidence = Clamp(item.Confidence)
            })
            .ToList(),
        Tasks = tasks
            .Where(item => !string.IsNullOrWhiteSpace(item.Title))
            .Select((item, index) =>
            {
                var normalizedDate = NormalizeDate(item.DueDate) ?? inferredDate;
                var normalizedWindow = string.IsNullOrWhiteSpace(item.TimeWindow) ? (index == 0 ? inferredTimeWindow : null) : item.TimeWindow.Trim();
                var normalizedTime = NormalizeTime(item.DueTime) ?? InferDueTime(normalizedWindow ?? string.Empty, normalizedWindow) ?? (index == 0 ? inferredTime : null);
        var inferredTaskCompanyName = string.IsNullOrWhiteSpace(item.CompanyName)
            ? InferCompanyNames($"{item.Title} {item.Description}")
                .Select(candidate => NormalizeInferredCompanyCandidate(candidate))
                .FirstOrDefault(candidate => !string.IsNullOrWhiteSpace(candidate) && LooksLikeMeaningfulCompanyName(candidate))
            : NormalizeInferredCompanyCandidate(item.CompanyName) ?? item.CompanyName.Trim();
        if (string.IsNullOrWhiteSpace(inferredTaskCompanyName) && index < segmentCompanyNames.Count)
        {
            inferredTaskCompanyName = segmentCompanyNames[index];
        }
        if (string.IsNullOrWhiteSpace(inferredTaskCompanyName) && inferredCompanyNames.Count == 1)
        {
            inferredTaskCompanyName = inferredCompanyNames[0];
        }
                return item with
                {
                    Title = item.Title.Trim(),
                    Description = string.IsNullOrWhiteSpace(item.Description) ? sourceText : item.Description.Trim(),
                    CompanyName = inferredTaskCompanyName,
                    Type = ExistingModuleType(item.Type),
                    DueDate = normalizedDate,
                    DueTime = normalizedTime,
                    TimeWindow = normalizedWindow,
                    Priority = NormalizePriority(item.Priority),
                    ReminderRule = NormalizeReminderRule(item.ReminderRule, normalizedDate, normalizedTime, language)
                };
            })
            .ToList(),
        Notes = analysis.Notes ?? [],
        OfferData = analysis.OfferData ?? new AiOfferData(false, [], [], "EUR"),
        DocumentData = analysis.DocumentData ?? new AiDocumentData(false, null)
    };
}

static string BuildAiNoteContent(string sourceText, AiCaptureAnalysis analysis)
{
    var parts = new List<string> { sourceText };
    if (analysis.OfferData.Detected)
    {
        var products = analysis.OfferData.Products.Count > 0 ? string.Join(", ", analysis.OfferData.Products) : "unknown products";
        var prices = analysis.OfferData.Prices.Count > 0 ? string.Join(", ", analysis.OfferData.Prices.Select(price => $"{price:0.##} {analysis.OfferData.Currency}")) : "no price";
        parts.Add($"Offer/price detected: {products}; {prices}.");
    }
    parts.AddRange(analysis.Notes.Where(note => !string.IsNullOrWhiteSpace(note)));
    return string.Join(Environment.NewLine, parts.Distinct());
}

static AiCaptureAnalysis ParseAiAnalysisContent(string content)
{
    var candidate = ExtractFirstJsonObject(content) ?? content;

    try
    {
        var direct = JsonSerializer.Deserialize<AiCaptureAnalysis>(candidate, JsonOptions());
        if (direct is not null)
        {
            return direct;
        }
    }
    catch
    {
    }

    JsonNode? rootNode;
    try
    {
        rootNode = JsonNode.Parse(candidate);
    }
    catch (Exception exception)
    {
        throw new InvalidOperationException($"OpenAI analysis JSON could not be parsed. Raw content: {content}", exception);
    }

    if (rootNode is not JsonObject root)
    {
        throw new InvalidOperationException($"OpenAI returned an unexpected JSON shape. Raw content: {content}");
    }

    var companyNode = root["company"] as JsonObject;
    var offerNode = root["offerData"] as JsonObject;
    var documentNode = root["documentData"] as JsonObject;

    return new AiCaptureAnalysis
    {
        DetectedLanguage = ReadString(root["detectedLanguage"]) ?? "en",
        Company = new AiCompany(
            ReadString(companyNode?["name"]),
            ReadDouble(companyNode?["confidence"]),
            ReadBool(companyNode?["shouldCreateIfMissing"])),
        Modules = ReadArray(root["modules"])
            .Select(node => node as JsonObject)
            .Where(node => node is not null)
            .Select(node => new AiModule(
                ReadString(node!["name"]) ?? "To Do",
                ReadString(node!["type"]) ?? "todo",
                ReadDouble(node!["confidence"]),
                ReadBool(node!["shouldCreateIfMissing"])))
            .ToList(),
        Tasks = ReadArray(root["tasks"])
            .Select(node => node as JsonObject)
            .Where(node => node is not null)
            .Select(node => new AiTask(
                ReadString(node!["title"]) ?? "",
                ReadString(node!["description"]) ?? "",
                ReadString(node!["type"]) ?? "todo",
                ReadString(node!["dueDate"]),
                ReadString(node!["dueTime"]),
                ReadString(node!["timeWindow"]),
                ReadString(node!["priority"]) ?? "medium",
                ReadString(node!["reminderRule"]),
                ReadString(node!["companyName"]),
                ReadString(node!["contactPersonName"]),
                ReadDouble(node!["personConfidence"]),
                ReadBool(node!["isHabit"])))
            .ToList(),
        Notes = ReadArray(root["notes"]).Select(ReadString).Where(item => !string.IsNullOrWhiteSpace(item)).Select(item => item!).ToList(),
        OfferData = new AiOfferData(
            ReadBool(offerNode?["detected"]),
            ReadArray(offerNode?["products"]).Select(ReadString).Where(item => !string.IsNullOrWhiteSpace(item)).Select(item => item!).ToList(),
            ReadArray(offerNode?["prices"]).Select(ReadDecimal).Where(item => item.HasValue).Select(item => item!.Value).ToList(),
            ReadString(offerNode?["currency"]) ?? "EUR"),
        DocumentData = new AiDocumentData(
            ReadBool(documentNode?["detected"]),
            ReadString(documentNode?["type"]))
    };
}

static string? ExtractFirstJsonObject(string content)
{
    var start = content.IndexOf('{');
    if (start < 0)
    {
        return null;
    }

    var depth = 0;
    var inString = false;
    var escaped = false;
    for (var index = start; index < content.Length; index++)
    {
        var ch = content[index];
        if (escaped)
        {
            escaped = false;
            continue;
        }

        if (ch == '\\')
        {
            escaped = true;
            continue;
        }

        if (ch == '"')
        {
            inString = !inString;
            continue;
        }

        if (inString)
        {
            continue;
        }

        if (ch == '{')
        {
            depth++;
        }
        else if (ch == '}')
        {
            depth--;
            if (depth == 0)
            {
                return content[start..(index + 1)];
            }
        }
    }

    return null;
}

static List<JsonNode?> ReadArray(JsonNode? node) => node is JsonArray array ? array.ToList() : [];
static string? ReadString(JsonNode? node) => node?.GetValue<string?>();
static bool ReadBool(JsonNode? node)
{
    if (node is null) return false;
    if (node is JsonValue value)
    {
        if (value.TryGetValue<bool>(out var boolValue)) return boolValue;
        if (value.TryGetValue<string>(out var stringValue) && bool.TryParse(stringValue, out var parsed)) return parsed;
    }
    return false;
}

static double ReadDouble(JsonNode? node)
{
    if (node is null) return 0;
    if (node is JsonValue value)
    {
        if (value.TryGetValue<double>(out var doubleValue)) return doubleValue;
        if (value.TryGetValue<decimal>(out var decimalValue)) return (double)decimalValue;
        if (value.TryGetValue<string>(out var stringValue) && double.TryParse(stringValue, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }
    }
    return 0;
}

static decimal? ReadDecimal(JsonNode? node)
{
    if (node is null) return null;
    if (node is JsonValue value)
    {
        if (value.TryGetValue<decimal>(out var decimalValue)) return decimalValue;
        if (value.TryGetValue<double>(out var doubleValue)) return (decimal)doubleValue;
        if (value.TryGetValue<string>(out var stringValue) && decimal.TryParse(stringValue, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }
    }
    return null;
}

static bool ShouldTreatTaskAsPersonal(AiTask task, bool hasCompanyContext)
{
    var normalizedType = ExistingModuleType(task.Type);
    var haystack = NormalizeKeywordText($"{task.Title} {task.Description}");
    var personalKeywords = new[]
    {
        "market", "markete", "alisveris", "kiyma", "arkadas", "bulus", "bulusma", "ozel", "randevu", "manav", "kasap", "firin"
    };
    var businessKeywords = new[]
    {
        "teklif", "angebot", "offer", "fatura", "rechnung", "invoice", "kurulum", "installation", "destek", "support",
        "olc", "olcum", "musteri", "odeme", "rapor", "teslim", "firma"
    };

    if (hasCompanyContext)
    {
        return false;
    }

    if (personalKeywords.Any(keyword => haystack.Contains(keyword)))
    {
        return true;
    }

    if (normalizedType != "todo" && normalizedType != "custom")
    {
        return false;
    }

    if (businessKeywords.Any(keyword => haystack.Contains(keyword)))
    {
        return false;
    }

    return !hasCompanyContext;
}

static async Task<List<WorkModuleEntity>> ResolveModulesForAiTask(ArxTaskDbContext db, string userId, AiCaptureAnalysis analysis, AiTask task, bool isPersonal, string language)
{
    var moduleCandidates = new List<AiModule>();
    if (isPersonal)
    {
        moduleCandidates.Add(new AiModule(GetPersonalModuleName(language), "custom", 1, true));
    }
    else
    {
        var taskType = ExistingModuleType(task.Type);
        moduleCandidates.AddRange(analysis.Modules
            .Where(item => item.Confidence >= 0.8 || ExistingModuleType(item.Type) != "custom")
            .Where(item => ExistingModuleType(item.Type) == taskType || taskType == "custom" && ExistingModuleType(item.Type) == "custom"));

        if (moduleCandidates.Count == 0)
        {
            moduleCandidates.Add(new AiModule(GetDefaultModuleName(taskType, task, language), taskType, 0.85, true));
        }
    }

    var modules = new List<WorkModuleEntity>();
    foreach (var moduleInfo in moduleCandidates.DistinctBy(item => $"{item.Name}|{ExistingModuleType(item.Type)}".ToLowerInvariant()))
    {
        var moduleName = string.IsNullOrWhiteSpace(moduleInfo.Name) ? "To Do" : moduleInfo.Name.Trim();
        var moduleType = ExistingModuleType(moduleInfo.Type);
        var module = db.Modules.Local.FirstOrDefault(item =>
            item.UserId == userId &&
            (item.Name.Equals(moduleName, StringComparison.OrdinalIgnoreCase) || item.Type == moduleType && moduleType != "custom"));

        if (module is null)
        {
            module = await db.Modules.FirstOrDefaultAsync(item =>
            item.UserId == userId &&
            (item.Name.ToLower() == moduleName.ToLower() || item.Type == moduleType && moduleType != "custom"));
        }

        if (module is null)
        {
            module = new WorkModuleEntity
            {
                Id = $"module-{Slug(moduleName)}",
                UserId = userId,
                Name = moduleName,
                Type = moduleType,
                CreatedByAI = true,
                IsPinnedToSidebar = true,
                TaskCount = 0,
                CreatedAt = DateTimeOffset.UtcNow
            };
            db.Modules.Add(module);
        }

        modules.Add(module);
    }

    return modules;
}

static bool ShouldCreateInvoiceDraftForTask(AiTask task, int taskCount)
{
    var lowered = $"{task.Title} {task.Description}".ToLowerInvariant();
    return taskCount == 1 && (lowered.Contains("fatura") || lowered.Contains("rechnung") || lowered.Contains("invoice"))
        || task.Type == "invoices"
        || lowered.Contains("fatura")
        || lowered.Contains("rechnung")
        || lowered.Contains("invoice");
}

static string GetPersonalModuleName(string language) =>
    NormalizeLanguage(language) switch
    {
        "de" => "Pers\u00F6nlich",
        "tr" => "Ki\u015Fisel",
        "fr" => "Personnel",
        "nl" => "Persoonlijk",
        "ar" => "\u0634\u062E\u0635\u064A",
        _ => "Personal"
    };

static string GetDefaultModuleName(string taskType, AiTask task, string language)
{
    return ExistingModuleType(taskType) switch
    {
        "visits" => "Visits",
        "calls" => "Calls",
        "offers" => "Offers",
        "invoices" => "Invoices",
        "installation" => "Installation",
        "removal" => "Removal",
        "repair" => "Repair",
        "support" => "Support",
        "payments" => "Payments",
        "projects" => "Projects",
        "delivery" => "Delivery",
        "measurements" => "Measurements",
        "todo" => NormalizeLanguage(language) == "tr" ? "Yap\u0131lacak" : "To Do",
        _ => InferAiCustomModuleName(task)
    };
}

static string InferAiCustomModuleName(AiTask task)
{
    var lowered = NormalizeKeywordText($"{task.Title} {task.Description}");
    if (lowered.Contains("rapor"))
    {
        return "Raporlar";
    }
    if (lowered.Contains("teslim"))
    {
        return "Teslimat";
    }
    return "To Do";
}

static string NormalizeKeywordText(string value)
{
    return value
        .ToLowerInvariant()
        .Replace("\u0131", "i")
        .Replace("\u00F6", "o")
        .Replace("\u00FC", "u")
        .Replace("\u015F", "s")
        .Replace("\u00E7", "c")
        .Replace("\u011F", "g");
}

static bool ShouldCreateOfferDraft(AiCaptureAnalysis analysis, AiTask task, int taskCount)
{
    var lowered = $"{task.Title} {task.Description}".ToLowerInvariant();
    return analysis.OfferData.Detected
        && taskCount == 1
        || task.Type == "offers"
        || lowered.Contains("teklif")
        || lowered.Contains("angebot")
        || lowered.Contains("offer");
}

static bool ShouldCreateInvoiceDraftLegacy(AiTask task, int taskCount)
{
    var lowered = $"{task.Title} {task.Description}".ToLowerInvariant();
    return taskCount == 1 && (lowered.Contains("fatura") || lowered.Contains("rechnung") || lowered.Contains("invoice"))
        || task.Type == "offers"
        || lowered.Contains("teklif")
        || lowered.Contains("angebot")
        || lowered.Contains("offer");
}

static bool IsPersonalTaskLegacy(AiTask task, bool hasCompanyContext)
{
    var normalizedType = ExistingModuleType(task.Type);
    var haystack = $"{task.Title} {task.Description}".ToLower(new CultureInfo("tr-TR"));
    var personalKeywords = new[]
    {
        "market", "markete", "alışveriş", "alisveris", "kıyma", "kiyma", "arkadaş", "arkadas", "buluş", "bulus",
        "buluşma", "bulusma", "ev", "özel", "ozel", "randevu", "manav", "kasap", "fırın", "firin"
    };
    var businessKeywords = new[]
    {
        "teklif", "angebot", "offer", "fatura", "rechnung", "invoice", "kurulum", "installation", "destek", "support",
        "ölç", "olc", "ölçüm", "olcum", "müşteri", "musteri", "ödeme", "odeme", "rapor", "teslim", "firma", "market'e git"
    };

    if (personalKeywords.Any(keyword => haystack.Contains(keyword)))
    {
        return true;
    }

    if (normalizedType != "todo" && normalizedType != "custom")
    {
        return false;
    }

    if (businessKeywords.Any(keyword => haystack.Contains(keyword)))
    {
        return false;
    }

    return !hasCompanyContext;
}

static async Task<List<WorkModuleEntity>> ResolveModulesForTaskLegacy(ArxTaskDbContext db, string userId, AiCaptureAnalysis analysis, AiTask task, bool isPersonal, string language)
{
    var moduleCandidates = new List<AiModule>();
    if (isPersonal)
    {
        moduleCandidates.Add(new AiModule(PersonalModuleNameLegacy(language), "custom", 1, true));
    }
    else
    {
        var taskType = ExistingModuleType(task.Type);
        moduleCandidates.AddRange(analysis.Modules
            .Where(item => item.Confidence >= 0.8 || ExistingModuleType(item.Type) != "custom")
            .Where(item => ExistingModuleType(item.Type) == taskType || taskType == "custom" && ExistingModuleType(item.Type) == "custom"));

        if (moduleCandidates.Count == 0)
        {
            moduleCandidates.Add(new AiModule(ModuleNameForTaskLegacy(taskType, task, language), taskType, 0.85, true));
        }
    }

    var modules = new List<WorkModuleEntity>();
    foreach (var moduleInfo in moduleCandidates.DistinctBy(item => $"{item.Name}|{ExistingModuleType(item.Type)}".ToLowerInvariant()))
    {
        var moduleName = string.IsNullOrWhiteSpace(moduleInfo.Name) ? "To Do" : moduleInfo.Name.Trim();
        var moduleType = ExistingModuleType(moduleInfo.Type);
        var module = await db.Modules.FirstOrDefaultAsync(item =>
            item.UserId == userId &&
            (item.Name.ToLower() == moduleName.ToLower() || item.Type == moduleType && moduleType != "custom"));

        if (module is null)
        {
            module = new WorkModuleEntity
            {
                Id = $"module-{Slug(moduleName)}",
                UserId = userId,
                Name = moduleName,
                Type = moduleType,
                CreatedByAI = true,
                IsPinnedToSidebar = true,
                TaskCount = 0,
                CreatedAt = DateTimeOffset.UtcNow
            };
            db.Modules.Add(module);
        }

        modules.Add(module);
    }

    return modules;
}

static string PersonalModuleNameLegacy(string language) =>
    NormalizeLanguage(language) switch
    {
        "de" => "Persönlich",
        "tr" => "Kişisel",
        "fr" => "Personnel",
        "nl" => "Persoonlijk",
        "ar" => "شخصي",
        _ => "Personal"
    };

static string ModuleNameForTaskLegacy(string taskType, AiTask task, string language)
{
    return ExistingModuleType(taskType) switch
    {
        "visits" => "Visits",
        "calls" => "Calls",
        "offers" => "Offers",
        "invoices" => "Invoices",
        "installation" => "Installation",
        "removal" => "Removal",
        "repair" => "Repair",
        "support" => "Support",
        "payments" => "Payments",
        "projects" => "Projects",
        "delivery" => "Delivery",
        "measurements" => "Measurements",
        "todo" => NormalizeLanguage(language) == "tr" ? "Yapılacak" : "To Do",
        _ => InferCustomModuleNameLegacy(task)
    };
}

static string InferCustomModuleNameLegacy(AiTask task)
{
    var lowered = $"{task.Title} {task.Description}".ToLower(new CultureInfo("tr-TR"));
    if (lowered.Contains("rapor"))
    {
        return "Raporlar";
    }
    if (lowered.Contains("teslim"))
    {
        return "Teslimat";
    }
    return "To Do";
}

static bool ShouldCreateInvoiceDraftLegacy2(AiTask task, int taskCount)
{
    var lowered = $"{task.Title} {task.Description}".ToLowerInvariant();
    return taskCount == 1 && (lowered.Contains("fatura") || lowered.Contains("rechnung") || lowered.Contains("invoice"))
        || lowered.Contains("fatura")
        || lowered.Contains("rechnung")
        || lowered.Contains("invoice");
}

static async Task<OfferEntity> CreateAiOfferDraft(ArxTaskDbContext db, string userId, CompanyEntity company, BusinessTaskEntity task, AiCaptureAnalysis analysis)
{
    var existing = await db.Offers
        .Include(item => item.Items)
        .FirstOrDefaultAsync(item => item.UserId == userId && item.CompanyId == company.Id && item.Title == task.Title && item.Status == "draft");
    if (existing is not null)
    {
        return existing;
    }

    var catalog = await db.Products.Where(item => item.UserId == userId).ToListAsync();
    var items = CreatePricedItems(userId, analysis.OfferData, "offer-item", catalog)
        .Select(item =>
        {
            item.OfferId = "";
            return item;
        })
        .ToList();

    var offer = new OfferEntity
    {
        Id = NewId("offer"),
        UserId = userId,
        CompanyId = company.Id,
        OfferNumber = $"AN-{DateTime.UtcNow:yyyyMMdd-HHmm}",
        OfferDate = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"),
        Title = task.Title,
        Status = "draft",
        Currency = analysis.OfferData.Currency,
        ValidityDays = 14,
        Notes = BuildAiNoteContent(task.Description, analysis),
        Items = items
    };
    foreach (var item in offer.Items)
    {
        item.OfferId = offer.Id;
    }
    RecalculateOffer(offer);
    db.Offers.Add(offer);
    return offer;
}

static async Task<InvoiceEntity> CreateAiInvoiceDraft(ArxTaskDbContext db, string userId, CompanyEntity company, BusinessTaskEntity task, AiCaptureAnalysis analysis)
{
    var existing = await db.Invoices
        .Include(item => item.Items)
        .FirstOrDefaultAsync(item => item.UserId == userId && item.CompanyId == company.Id && item.InvoiceNumber.StartsWith("AI-"));
    if (existing is not null && existing.Status == "unpaid" && existing.DueDate == (task.DueDate ?? existing.DueDate))
    {
        return existing;
    }

    var invoiceCatalog = await db.Products.Where(item => item.UserId == userId).ToListAsync();
    var items = CreatePricedInvoiceItems(userId, analysis.OfferData, invoiceCatalog);
    var invoice = new InvoiceEntity
    {
        Id = NewId("invoice"),
        UserId = userId,
        CompanyId = company.Id,
        InvoiceNumber = $"AI-{DateTime.UtcNow:yyyyMMdd-HHmm}",
        InvoiceDate = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"),
        DueDate = task.DueDate ?? DateOnly.FromDateTime(DateTime.UtcNow.AddDays(14)).ToString("yyyy-MM-dd"),
        Status = task.Type == "payments" ? "overdue" : "unpaid",
        Items = items
    };
    foreach (var item in invoice.Items)
    {
        item.InvoiceId = invoice.Id;
    }
    RecalculateInvoice(invoice);
    db.Invoices.Add(invoice);
    return invoice;
}

static List<OfferItemEntity> CreatePricedItems(string userId, AiOfferData offerData, string prefix, List<ProductEntity>? catalog = null)
{
    if (offerData.Products.Count == 0 && offerData.Prices.Count == 0)
    {
        return
        [
            new OfferItemEntity
            {
                Id = NewId(prefix),
                UserId = userId,
                ProductName = "Service",
                Description = "AI-created draft item",
                Quantity = 1,
                UnitPrice = 0,
                TotalPrice = 0
            }
        ];
    }

    // Ürün kataloğu eşleşmesi: AI'nin çıkardığı ad katalogdaki bir ürünle örtüşüyorsa
    // katalog adını kullan; not fiyat vermemişse katalog satış fiyatını uygula (R5).
    ProductEntity? MatchCatalog(string productName)
    {
        if (catalog is null || catalog.Count == 0) return null;
        var fold = NormalizeCompanyFold(productName);
        if (string.IsNullOrWhiteSpace(fold)) return null;
        return catalog.FirstOrDefault(item =>
        {
            var itemFold = NormalizeCompanyFold(item.Name);
            return !string.IsNullOrWhiteSpace(itemFold) &&
                   (itemFold == fold || itemFold.Contains(fold, StringComparison.Ordinal) || fold.Contains(itemFold, StringComparison.Ordinal));
        });
    }

    return offerData.Products.Select((product, index) =>
    {
        var price = index < offerData.Prices.Count ? offerData.Prices[index] : 0;
        var matched = MatchCatalog(product);
        if (matched is not null && price == 0)
        {
            price = matched.SellingPrice;
        }
        return new OfferItemEntity
        {
            Id = NewId(prefix),
            UserId = userId,
            ProductName = matched?.Name ?? product,
            Description = matched is null ? "AI-detected item" : $"Katalog: {matched.Category}".TrimEnd(':', ' '),
            Quantity = 1,
            UnitPrice = price,
            TotalPrice = price
        };
    }).ToList();
}

static List<InvoiceItemEntity> CreatePricedInvoiceItems(string userId, AiOfferData offerData, List<ProductEntity>? catalog = null)
{
    return CreatePricedItems(userId, offerData, "invoice-item", catalog)
        .Select(item => new InvoiceItemEntity
        {
            Id = item.Id,
            UserId = userId,
            ProductName = item.ProductName,
            Description = item.Description,
            Quantity = item.Quantity,
            UnitPrice = item.UnitPrice,
            TotalPrice = item.TotalPrice
        })
        .ToList();
}

static string? InferCompanyName(string sourceText)
{
    var normalized = Regex.Replace(sourceText, @"\s+", " ").Trim();
    var match = Regex.Match(
        normalized,
        @"(?<company>[\p{L}\d][\p{L}\d\s.'&-]{1,80}?)(?:(?:'|’)?(?:ye|ya|yi|yı|yu|yü|e|a))?(?:\s+)(?:gidip|gidicem|gidecem|git(?:tim|ti|mek|meye|meyi|cem|cegim|ceğim)?|gidece(?:ğim|gim|ksin|ğiz|giz|k)|gider|uğra(?:yacağım|yacam|)|ugra(?:yacağım|yacam|)|ziyaret|ara(?:yacağım|yacam)?|kurulum|montaj(?:a)?|ölç|olc)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    if (!match.Success)
    {
        return null;
    }

    var candidate = match.Groups["company"].Value;
    candidate = Regex.Replace(candidate, @"\b(?:bugün|bugun|yarın|yarin|saat|sonra|önce|once|akşam|aksam|sabah|öğlen|oglen)\b", " ", RegexOptions.IgnoreCase);
    candidate = Regex.Replace(candidate, @"\b\d{1,2}(?:[.:]\d{2})?(?:'?(?:de|da|te|ta))?\b", " ", RegexOptions.IgnoreCase);
    candidate = Regex.Replace(candidate, @"\s+", " ").Trim(' ', ',', '.', ';', ':');
    if (string.IsNullOrWhiteSpace(candidate))
    {
        return null;
    }

    var words = candidate.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();
    var last = words[^1].Trim();
    var apostropheIndex = last.IndexOf('\'');
    if (apostropheIndex > 0)
    {
        last = last[..apostropheIndex];
    }
    else
    {
        var lower = last.ToLower(new CultureInfo("tr-TR"));
        if (lower.EndsWith("ere", StringComparison.Ordinal) || lower.EndsWith("ara", StringComparison.Ordinal))
        {
            last = last[..^1];
        }
        else if (last.Length > 4 && (
            lower.EndsWith("ye", StringComparison.Ordinal) ||
            lower.EndsWith("ya", StringComparison.Ordinal) ||
            lower.EndsWith("yi", StringComparison.Ordinal) ||
            lower.EndsWith("yı", StringComparison.Ordinal) ||
            lower.EndsWith("yu", StringComparison.Ordinal) ||
            lower.EndsWith("yü", StringComparison.Ordinal)))
        {
            last = last[..^2];
        }
        // Note: bare trailing "e"/"a" stripping removed — was incorrectly truncating
        // legitimate names ("Mavi Tente" → "Mavi Tent", "Aslan Büfe" → "Aslan Büf").
        // The regex above already consumes the "e"/"a" suffix into a separate group.
    }
    words[^1] = last;

    var cleaned = string.Join(" ", words).Trim();
    return NormalizeInferredCompanyCandidate(cleaned);
}

static List<string> InferCompanyNames(string sourceText)
{
    var inferredNames = new List<string>();

    void AddCandidate(string? candidate)
    {
        var sanitizedCandidate = NormalizeInferredCompanyCandidate(candidate);
        if (string.IsNullOrWhiteSpace(sanitizedCandidate) || !LooksLikeMeaningfulCompanyName(sanitizedCandidate))
        {
            return;
        }

        var normalizedCandidate = NormalizeCompanyLookup(sanitizedCandidate);
        if (string.IsNullOrWhiteSpace(normalizedCandidate))
        {
            return;
        }

        if (inferredNames.Any(existing => NormalizeCompanyLookup(existing) == normalizedCandidate))
        {
            return;
        }

        inferredNames.Add(sanitizedCandidate);
    }

    foreach (var segment in SplitCompanyInferenceSegments(sourceText))
    {
        AddCandidate(InferCompanyName(segment));
    }

    AddCandidate(InferCompanyName(sourceText));

    return inferredNames;
}

static IEnumerable<string> SplitCompanyInferenceSegments(string sourceText)
{
    var normalized = Regex.Replace(sourceText ?? "", @"\s+", " ").Trim();
    if (string.IsNullOrWhiteSpace(normalized))
    {
        yield break;
    }

    foreach (var segment in Regex.Split(
        normalized,
        @"\b(?:sonra|ardından|ardindan|then|danach|ensuite)\b|[;\n]+",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
    {
        var trimmed = segment.Trim(' ', ',', '.', ';', ':');
        if (!string.IsNullOrWhiteSpace(trimmed))
        {
            yield return trimmed;
        }
    }
}

// AI bazen "Fiyat Teklifi Al Ahmet Döner" gibi action phrase + brand birleşimini
// companyName olarak döndürebiliyor. Burada sık karşılaşılan eylem ifadelerini
// adın başından / sonundan kazıyoruz — saf marka adı kalsın.
static string? StripActionPhrases(string? candidate)
{
    if (string.IsNullOrWhiteSpace(candidate)) return candidate;
    var cleaned = candidate.Trim();
    var actionPhrases = new[]
    {
        @"fiyat\s+teklifi\s+(?:al(?:acağım|acagim|acam|ıyorum|iyorum)?|iste)?",
        @"teklif\s+(?:al(?:acağım|acagim|acam)?|iste|verme)",
        @"(?:ölç(?:üm)?|olc(?:um)?)\s*(?:al(?:acağım|acagim|acam)?)?",
        @"ziyaret(?:e)?\s*(?:et|edicem|edeceğim)?",
        @"satış\s*yap(?:acağım|acagim|acam)?",
        @"satis\s*yap(?:acağım|acagim|acam)?",
        @"montaj(?:a)?\s*(?:yap(?:acağım|acagim|acam)?|git)?",
        @"kurulum\s*(?:yap(?:acağım|acagim|acam)?|al(?:acağım|acagim|acam)?)?",
        @"kontrol\s*(?:et(?:icem|eceğim)?)?",
        @"bilgi\s+al(?:acağım|acagim|acam)?",
        @"hatırlat(?:ma)?",
        @"hatirlat(?:ma)?",
        @"görüşme(?:ye)?",
        @"gorusme(?:ye)?",
        @"toplantı(?:ya)?",
        @"toplanti(?:ya)?"
    };
    foreach (var pattern in actionPhrases)
    {
        cleaned = Regex.Replace(cleaned, $@"^\s*{pattern}\s+", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        cleaned = Regex.Replace(cleaned, $@"\s+{pattern}\s*$", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }
    cleaned = cleaned.Trim(' ', ',', '.', ';', ':', '-', '–');
    return string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
}

static string? NormalizeInferredCompanyCandidate(string? candidate)
{
    if (string.IsNullOrWhiteSpace(candidate))
    {
        return null;
    }

    candidate = StripActionPhrases(candidate);
    if (string.IsNullOrWhiteSpace(candidate))
    {
        return null;
    }

    var culture = new CultureInfo("tr-TR");
    var cleaned = Regex.Replace(candidate, @"\s+", " ").Trim(' ', ',', '.', ';', ':', '-', '–');
    cleaned = Regex.Replace(cleaned, @"\b\d{1,2}(?:[.:]\d{2})?(?:'?(?:de|da|te|ta))?\b", " ", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    cleaned = Regex.Replace(cleaned, @"\s+", " ").Trim(' ', ',', '.', ';', ':', '-', '–');

    if (string.IsNullOrWhiteSpace(cleaned))
    {
        return null;
    }

    var leadingNoise = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "bugün", "bugun", "yarın", "yarin", "önümüzdeki", "onumuzdeki", "gelecek",
        "pazartesi", "salı", "sali", "çarşamba", "carsamba", "perşembe", "persembe",
        "cuma", "cumartesi", "pazar", "saat", "sonra", "ardından", "ardindan",
        "önce", "once", "sabah", "öğlen", "ogle", "öğle", "oglen", "akşam", "aksam",
        "gece", "öğleden", "ogleden"
    };

    var trailingNoise = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "git", "gidip", "gidicem", "gidecem", "gideceğim", "gidecegim", "uğra", "ugra",
        "uğrayacağım", "ugrayacagim", "uğrayacam", "ugrayacam", "yap", "yapacağım",
        "yapacagim", "montaj", "montaja", "ekran", "kurulum", "ölç", "olc", "al",
        "alacağım", "alacagim", "ziyaret", "edicem", "edeceğim", "edecegim", "montajı", "kurulumu"
    };

    var words = cleaned
        .Split(' ', StringSplitOptions.RemoveEmptyEntries)
        .Select(item => item.Trim(' ', ',', '.', ';', ':', '-', '–'))
        .Where(item => !string.IsNullOrWhiteSpace(item))
        .ToList();

    while (words.Count > 0 && leadingNoise.Contains(words[0]))
    {
        words.RemoveAt(0);
    }

    while (words.Count > 0 && trailingNoise.Contains(words[^1]))
    {
        words.RemoveAt(words.Count - 1);
    }

    if (words.Count == 0)
    {
        return null;
    }

    var lastWord = words[^1];
    var apostropheIndex = lastWord.IndexOf('\'');
    if (apostropheIndex > 0)
    {
        lastWord = lastWord[..apostropheIndex];
    }
    else
    {
        // Only strip clearly-suffix-shaped endings ("ye", "ya", "yi", "yı", "yu", "yü").
        // Stripping a bare trailing "e"/"a" was too aggressive: legitimate names like
        // "Mavi Tente" or "Aslan Büfe" were being truncated to "Mavi Tent" / "Aslan Büf".
        var lowerLastWord = lastWord.ToLower(culture);
        var twoLetterSuffixes = new[] { "ye", "ya", "yi", "yı", "yu", "yü" };
        if (lastWord.Length > 4 && twoLetterSuffixes.Any(suffix => lowerLastWord.EndsWith(suffix, StringComparison.Ordinal)))
        {
            lastWord = lastWord[..^2];
        }
    }

    words[^1] = lastWord.Trim(' ', ',', '.', ';', ':', '-', '–');
    words = words.Where(item => !string.IsNullOrWhiteSpace(item) && !trailingNoise.Contains(item)).ToList();

    if (words.Count == 0)
    {
        return null;
    }

    cleaned = string.Join(" ", words).Trim();
    if (!LooksLikeMeaningfulCompanyName(cleaned))
    {
        return null;
    }

    return culture.TextInfo.ToTitleCase(cleaned.ToLower(culture));
}

static bool LooksLikeMeaningfulCompanyName(string? candidate)
{
    if (string.IsNullOrWhiteSpace(candidate))
    {
        return false;
    }

    var culture = new CultureInfo("tr-TR");
    var normalized = candidate.Trim();
    if (normalized.Length < 3 || normalized.Length > 60)
    {
        return false;
    }

    var lower = normalized.ToLower(culture);
    var blockedSingles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "ekran", "kurulum", "montaj", "ölçü", "olcu", "ölç", "olc", "yap", "git", "market", "büfe", "bufe", "döner", "doner"
    };

    if (!normalized.Contains(' ') && blockedSingles.Contains(lower))
    {
        return false;
    }

    if (!Regex.IsMatch(normalized, @"[\p{L}]"))
    {
        return false;
    }

    return true;
}

static string? InferDueDate(string sourceText, string today)
{
    if (!DateOnly.TryParse(today, out var todayDate))
    {
        return null;
    }

    var lowered = sourceText.ToLower(new CultureInfo("tr-TR"));
    if (Regex.IsMatch(lowered, @"\b(yarın|yarin|tomorrow|morgen|demain|morgen)\b", RegexOptions.IgnoreCase))
    {
        return todayDate.AddDays(1).ToString("yyyy-MM-dd");
    }
    if (Regex.IsMatch(lowered, @"\b(bugün|bugun|today|heute|aujourd'hui|vandaag)\b", RegexOptions.IgnoreCase))
    {
        return todayDate.ToString("yyyy-MM-dd");
    }

    return null;
}

static string? InferTimeWindow(string sourceText)
{
    var lowered = sourceText.ToLower(new CultureInfo("tr-TR"));
    if (Regex.IsMatch(lowered, @"\b(sabah|morning|morgen früh|matin)\b", RegexOptions.IgnoreCase))
    {
        return "morning";
    }
    if (Regex.IsMatch(lowered, @"\b(öğlen|oglen|öğle|ogle|noon|mittag|midi)\b", RegexOptions.IgnoreCase))
    {
        return "noon";
    }
    if (Regex.IsMatch(lowered, @"\b(öğleden sonra|ogleden sonra|afternoon|nachmittag|après-midi)\b", RegexOptions.IgnoreCase))
    {
        return "afternoon";
    }
    if (Regex.IsMatch(lowered, @"\b(akşam|aksam|evening|abend|soir)\b", RegexOptions.IgnoreCase))
    {
        return "evening";
    }
    if (Regex.IsMatch(lowered, @"\b(gece yarısı|geceyarısı|midnight|minuit|mitternacht)\b", RegexOptions.IgnoreCase))
    {
        return "midnight";
    }
    if (Regex.IsMatch(lowered, @"\b(gece|night|nacht|nuit)\b", RegexOptions.IgnoreCase))
    {
        return "night";
    }
    return null;
}

static string? InferDueTime(string sourceText, string? inferredWindow = null)
{
    var match = Regex.Match(sourceText, @"(?:saat\s*)?(?<hour>[01]?\d|2[0-3])(?:[.:](?<minute>[0-5]\d))\s*(?:'?(?:de|da|te|ta))?", RegexOptions.IgnoreCase);
    if (!match.Success)
    {
        return ApproximateTimeForWindow(inferredWindow ?? InferTimeWindow(sourceText));
    }

    var hour = int.Parse(match.Groups["hour"].Value, CultureInfo.InvariantCulture);
    var minute = match.Groups["minute"].Success ? int.Parse(match.Groups["minute"].Value, CultureInfo.InvariantCulture) : 0;
    return new TimeOnly(hour, minute).ToString("HH:mm");
}

static string? ApproximateTimeForWindow(string? window)
{
    return window?.Trim().ToLowerInvariant() switch
    {
        "morning" => "09:00",
        "noon" => "12:00",
        "afternoon" => "15:00",
        "evening" => "19:00",
        "night" => "21:00",
        "midnight" => "00:00",
        _ => null
    };
}

static string? NormalizeReminderRule(string? value, string? dueDate, string? dueTime, string language)
{
    if (!string.IsNullOrWhiteSpace(value))
    {
        var trimmed = value.Trim();
        if (trimmed.Equals("start 5 hours before due time, repeat every hour until due time or done", StringComparison.OrdinalIgnoreCase))
        {
            value = null;
        }
        else
        {
            var intervalMatch = Regex.Match(trimmed, @"Remind every hour from\s+(?<start>\d{2}:\d{2})\s+until\s+(?<end>\d{2}:\d{2})", RegexOptions.IgnoreCase);
            if (intervalMatch.Success)
            {
                var startText = intervalMatch.Groups["start"].Value;
                var endText = intervalMatch.Groups["end"].Value;
                return language == "tr"
                    ? $"{startText}'dan {endText}'e kadar her saat hatirlat"
                    : trimmed;
            }

            return trimmed;
        }
    }

    if (string.IsNullOrWhiteSpace(dueDate) || string.IsNullOrWhiteSpace(dueTime) || !TimeOnly.TryParse(dueTime, out var time))
    {
        return null;
    }

    var start = time.AddHours(-5);
    return language == "tr"
        ? $"{start:HH\\:mm}'dan {time:HH\\:mm}'a kadar saat başı hatırlat"
        : $"Remind every hour from {start:HH\\:mm} until {time:HH\\:mm} or done";
}

static string NormalizeCompanyLookup(string? value)
{
    var culture = new CultureInfo("tr-TR");
    var normalized = (value ?? "")
        .Trim()
        .Replace("’", "'")
        .Replace("`", "'");

    while (normalized.Contains("  ", StringComparison.Ordinal))
    {
        normalized = normalized.Replace("  ", " ", StringComparison.Ordinal);
    }

    return normalized.ToLower(culture);
}

// A diacritic-FOLDED, punctuation-stripped comparison key. This is what makes
// "Ensar Döner" and "Ensar Doner", or "İpek Tekstil" and "Ipek Tekstil", collide
// instead of spawning duplicate companies. Turkish speech-to-text and keyboards
// inconsistently emit ö/o, İ/I/ı, ş/s, ğ/g, ç/c, ü/u, so folding them to a common
// ASCII form is essential for reliable matching.
static string NormalizeCompanyFold(string? value)
{
    var lookup = NormalizeCompanyLookup(value); // trims, collapses spaces, tr-TR lowercases
    var sb = new StringBuilder(lookup.Length);
    foreach (var ch in lookup)
    {
        var mapped = ch switch
        {
            'ı' or 'i' or 'î' or 'İ' => 'i',
            'ş' => 's',
            'ğ' => 'g',
            'ç' => 'c',
            'ö' => 'o',
            'ü' => 'u',
            'â' => 'a',
            'û' => 'u',
            _ => ch
        };
        if (char.IsLetterOrDigit(mapped)) sb.Append(mapped);
        else if (mapped == ' ') sb.Append(' ');
        // all other punctuation ('.', '&', '-', apostrophes, …) is dropped
    }

    var folded = sb.ToString().Trim();
    while (folded.Contains("  ", StringComparison.Ordinal))
    {
        folded = folded.Replace("  ", " ", StringComparison.Ordinal);
    }
    return folded;
}

static int LevenshteinDistance(string a, string b)
{
    if (a == b) return 0;
    if (a.Length == 0) return b.Length;
    if (b.Length == 0) return a.Length;

    var prev = new int[b.Length + 1];
    var cur = new int[b.Length + 1];
    for (var j = 0; j <= b.Length; j++) prev[j] = j;
    for (var i = 1; i <= a.Length; i++)
    {
        cur[0] = i;
        for (var j = 1; j <= b.Length; j++)
        {
            var cost = a[i - 1] == b[j - 1] ? 0 : 1;
            cur[j] = Math.Min(Math.Min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
        }
        (prev, cur) = (cur, prev);
    }
    return prev[b.Length];
}

// Similarity in [0,1] over two already-folded company keys. Uses the larger of a
// Levenshtein ratio (catches typos/dropped letters/suffixes) and a token-set overlap
// (catches word-order and extra/missing words like "…cilik", "Ltd", "Şti").
static double CompanyNameSimilarity(string foldA, string foldB)
{
    if (string.IsNullOrEmpty(foldA) || string.IsNullOrEmpty(foldB)) return 0d;
    if (foldA == foldB) return 1d;

    var dist = LevenshteinDistance(foldA, foldB);
    var maxLen = Math.Max(foldA.Length, foldB.Length);
    var levRatio = maxLen == 0 ? 0d : 1d - (double)dist / maxLen;

    var setA = foldA.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
    var setB = foldB.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
    var tokenRatio = 0d;
    if (setA.Count > 0 && setB.Count > 0)
    {
        var intersection = setA.Intersect(setB).Count();
        var union = setA.Union(setB).Count();
        tokenRatio = union == 0 ? 0d : (double)intersection / union;
    }

    return Math.Max(levRatio, tokenRatio);
}

// Near-match acceptance threshold. Above this the two names are surfaced to the user
// as "is this the same company?" rather than silently creating a duplicate.
static double CompanyFuzzyMatchThreshold() => 0.85d;

static string NormalizeTaskLookup(string? value)
{
    var normalized = (value ?? "").Trim();
    while (normalized.Contains("  ", StringComparison.Ordinal))
    {
        normalized = normalized.Replace("  ", " ", StringComparison.Ordinal);
    }

    return normalized.ToLowerInvariant();
}

static string? NormalizeDomain(string? value)
{
    if (string.IsNullOrWhiteSpace(value))
    {
        return null;
    }

    var normalized = value.Trim().TrimStart('@').Trim().ToLowerInvariant();
    return normalized.Length == 0 ? null : normalized;
}

static string? ExtractDomainFromEmail(string? value)
{
    if (string.IsNullOrWhiteSpace(value))
    {
        return null;
    }

    var normalized = NormalizeEmail(value);
    var atIndex = normalized.LastIndexOf('@');
    if (atIndex < 0 || atIndex == normalized.Length - 1)
    {
        return null;
    }

    return NormalizeDomain(normalized[(atIndex + 1)..]);
}

static string? ExtractDomainFromSourceText(string sourceText)
{
    var match = Regex.Match(
        sourceText,
        @"(?<![\w.-])(?:[\w.+-]+@)?(?<domain>[a-z0-9-]+(?:\.[a-z0-9-]+)+)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    return match.Success ? NormalizeDomain(match.Groups["domain"].Value) : null;
}

// Graded match strength between a spoken/parsed name and a stored company:
//   3 = exact (normalized) OR diacritic-fold-exact  -> definitely the same company (auto-bind)
//   2 = email-domain match                           -> strong signal
//   1 = fuzzy near-match (>= threshold)              -> ask the user "same company?"
//   0 = no match
static int CompanyMatchTier(CompanyEntity company, string normalizedCompanyName, string foldCompanyName, string? domain)
{
    if (!string.IsNullOrWhiteSpace(normalizedCompanyName) &&
        NormalizeCompanyLookup(company.Name) == normalizedCompanyName)
    {
        return 3;
    }
    if (!string.IsNullOrWhiteSpace(foldCompanyName) &&
        NormalizeCompanyFold(company.Name) == foldCompanyName)
    {
        return 3;
    }
    if (!string.IsNullOrWhiteSpace(domain) &&
        string.Equals(ExtractDomainFromEmail(company.Email), domain, StringComparison.OrdinalIgnoreCase))
    {
        return 2;
    }
    if (!string.IsNullOrWhiteSpace(foldCompanyName) &&
        CompanyNameSimilarity(NormalizeCompanyFold(company.Name), foldCompanyName) >= CompanyFuzzyMatchThreshold())
    {
        return 1;
    }
    return 0;
}

// True when the two names are the same company beyond doubt (exact or diacritic-only
// difference) — used to auto-bind without prompting.
static bool IsDefiniteCompanyMatch(string? spokenName, string? storedName)
{
    var fold = NormalizeCompanyFold(spokenName);
    return !string.IsNullOrWhiteSpace(fold) && NormalizeCompanyFold(storedName) == fold;
}

static async Task<List<CompanyEntity>> FindMatchingCompanies(ArxTaskDbContext db, string userId, string? companyName, string sourceText)
{
    var normalizedCompanyName = NormalizeCompanyLookup(companyName);
    var foldCompanyName = NormalizeCompanyFold(companyName);
    var domain = ExtractDomainFromSourceText(sourceText);
    var companies = await db.Companies
        .Where(item => item.UserId == userId)
        .ToListAsync();

    return companies
        .Select(item => (company: item, tier: CompanyMatchTier(item, normalizedCompanyName, foldCompanyName, domain)))
        .Where(entry => entry.tier > 0)
        .OrderByDescending(entry => entry.tier)
        .ThenByDescending(entry => entry.company.UpdatedAt)
        .Select(entry => entry.company)
        .ToList();
}

/// <summary>
/// Finds an existing company whose name appears as a whole-word substring of
/// the candidate name or the source text. Used to redirect a noisy parsed name
/// like "Bu Çetin Döner'e İş Görüşmesin" to the existing "Çetin Döner" record
/// instead of creating a new firm. Longest match wins so "Çetin Döner" is
/// preferred over a shorter "Çetin".
/// </summary>
static async Task<CompanyEntity?> FindExistingCompanyByMention(
    ArxTaskDbContext db,
    string userId,
    string? candidateName,
    string sourceText)
{
    var companies = await db.Companies
        .Where(item => item.UserId == userId && item.Name != null && item.Name != "")
        .ToListAsync();
    if (companies.Count == 0) return null;

    var haystacks = new List<string>();
    var normalizedCandidate = NormalizeCompanyLookup(candidateName);
    if (!string.IsNullOrWhiteSpace(normalizedCandidate)) haystacks.Add(normalizedCandidate);
    var normalizedSource = NormalizeCompanyLookup(sourceText);
    if (!string.IsNullOrWhiteSpace(normalizedSource)) haystacks.Add(normalizedSource);
    if (haystacks.Count == 0) return null;

    static bool ContainsWholeWord(string haystack, string needle)
    {
        if (string.IsNullOrWhiteSpace(haystack) || string.IsNullOrWhiteSpace(needle)) return false;
        // Word boundary: start/end of string or non-letter/non-digit character.
        // Turkish letters need \p{L} to be respected — use a negative class.
        var pattern = $@"(?:^|[^\p{{L}}\d]){Regex.Escape(needle)}(?:$|[^\p{{L}}\d])";
        return Regex.IsMatch(haystack, pattern, RegexOptions.CultureInvariant);
    }

    return companies
        .Where(company =>
        {
            var n = NormalizeCompanyLookup(company.Name);
            if (string.IsNullOrWhiteSpace(n) || n.Length < 3) return false;
            return haystacks.Any(h => ContainsWholeWord(h, n));
        })
        .OrderByDescending(company => company.Name.Length)
        .ThenByDescending(company => company.UpdatedAt)
        .FirstOrDefault();
}

static async Task<BusinessTaskEntity?> FindExistingOpenTaskForAiCommit(
    ArxTaskDbContext db,
    string userId,
    AiTask parsedTask,
    CompanyEntity? taskCompany)
{
    var normalizedTitle = NormalizeTaskLookup(parsedTask.Title);
    var normalizedCompanyName = taskCompany is null ? null : NormalizeCompanyLookup(taskCompany.Name);

    var localMatch = db.Tasks.Local.FirstOrDefault(item =>
        item.UserId == userId &&
        item.Status != "done" &&
        NormalizeTaskLookup(item.Title) == normalizedTitle &&
        item.DueDate == parsedTask.DueDate &&
        item.CompanyId == taskCompany?.Id);

    if (localMatch is not null)
    {
        return localMatch;
    }

    var candidates = await db.Tasks
        .Where(item =>
            item.UserId == userId &&
            item.Status != "done" &&
            item.DueDate == parsedTask.DueDate &&
            item.Title.ToLower() == parsedTask.Title.ToLower())
        .ToListAsync();

    if (candidates.Count == 0)
    {
        return null;
    }

    if (taskCompany is null)
    {
        return candidates.FirstOrDefault(item => item.CompanyId is null);
    }

    var companyIds = candidates
        .Where(item => item.CompanyId is not null)
        .Select(item => item.CompanyId!)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToList();

    var companies = companyIds.Count == 0
        ? []
        : await db.Companies
            .Where(item => item.UserId == userId && companyIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item);

    return candidates.FirstOrDefault(item =>
        item.CompanyId is not null &&
        companies.TryGetValue(item.CompanyId, out var candidateCompany) &&
        NormalizeCompanyLookup(candidateCompany.Name) == normalizedCompanyName);
}

static string ReminderStartTime(AiTask task)
{
    if (DateOnly.TryParse(task.DueDate, out var date) && TimeOnly.TryParse(task.DueTime, out var time))
    {
        return date.ToDateTime(time.AddHours(-5)).ToString("yyyy-MM-ddTHH:mm");
    }

    return task.DueDate ?? DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
}

static async Task SyncTaskAlertsForTask(ArxTaskDbContext db, string userId, BusinessTaskEntity task, ReminderEntity? reminder)
{
    // Default time fallback: if the user gave a due date but no time (and the
    // AI couldn't infer one from a time-window word like "akşam"), schedule
    // alerts as if the task was due at 10:00. This keeps the day's reminder
    // visible instead of silently producing zero alerts.
    if (string.IsNullOrWhiteSpace(task.DueTime) && !string.IsNullOrWhiteSpace(task.DueDate))
    {
        task.DueTime = "10:00";
    }

    var pendingAlerts = await db.TaskAlerts
        .Where(item => item.UserId == userId && item.TaskId == task.Id && item.Status == "pending")
        .ToListAsync();

    if (pendingAlerts.Count > 0)
    {
        // Cancel the corresponding Hangfire jobs so cancelled / rescheduled
        // tasks don't fire stale reminders.
        foreach (var existing in pendingAlerts)
        {
            if (!string.IsNullOrWhiteSpace(existing.HangfireJobId))
            {
                try { BackgroundJob.Delete(existing.HangfireJobId); } catch { /* swallow — best effort */ }
            }
        }
        db.TaskAlerts.RemoveRange(pendingAlerts);
    }

    // Kullanıcının varsayılan "N dakika önce" ayarı: açık bir hatırlatıcı olmasa da
    // vadesi olan her görev için randevu öncesi bildirim kurulmasını sağlar (R10).
    var owner = await db.Users.FindAsync(userId);
    var defaultLeadMinutes = owner?.DefaultReminderLeadMinutes ?? 0;
    var reminderActive = reminder is not null && reminder.Status == "active" && reminder.NotificationsEnabled;

    if (task.Status == "done" || !task.NotificationsEnabled || (!reminderActive && defaultLeadMinutes <= 0))
    {
        task.NextAlertAt = null;
        task.AlertCount = 0;
        return;
    }

    var dueAt = ParseTaskDueAt(task);
    if (dueAt is null)
    {
        task.NextAlertAt = null;
        task.AlertCount = 0;
        return;
    }

    var now = DateTimeOffset.Now;
    var alerts = new List<TaskAlertEntity>();
    var rule = reminderActive ? (reminder!.RepeatInterval ?? task.ReminderInterval) : null;
    var schedule = BuildAlertSchedule(rule, dueAt.Value, now, defaultLeadMinutes);

    // Gecikme uyarıları (R14): vade geçtikten sonra görev hâlâ açıksa neden/ne kadar
    // geciktiğini soran bildirimler. Görev tamamlanınca bu kayıtlar iptal edilir.
    foreach (var (offset, kind) in new[] { (TimeSpan.FromHours(2), "overdue-2h"), (TimeSpan.FromHours(24), "overdue-1d") })
    {
        var at = dueAt.Value + offset;
        if (at > now) schedule.Add((at, kind));
    }
    foreach (var entry in schedule)
    {
        var rawToken = Guid.NewGuid().ToString("N");
        var alertId = NewId("task-alert");
        var alert = new TaskAlertEntity
        {
            Id = alertId,
            UserId = userId,
            TaskId = task.Id,
            ReminderId = reminder?.Id,
            ScheduledFor = entry.ScheduledFor,
            Kind = entry.Kind,
            Status = "pending",
            ActionTokenHash = HashToken(rawToken),
            ActionToken = rawToken
        };

        // Schedule the Hangfire job and store its id so it can be cancelled
        // when the task is updated / completed / deleted later.
        var delay = entry.ScheduledFor - DateTimeOffset.Now;
        if (delay < TimeSpan.Zero) delay = TimeSpan.Zero;
        var jobId = BackgroundJob.Schedule<INotificationDispatcher>(
            svc => svc.SendTaskAlertAsync(userId, alertId),
            delay);
        alert.HangfireJobId = jobId;

        alerts.Add(alert);
    }

    if (alerts.Count > 0)
    {
        db.TaskAlerts.AddRange(alerts);
        task.NextAlertAt = alerts.Min(item => item.ScheduledFor).ToString("O");
        task.AlertCount = alerts.Count;
    }
    else
    {
        task.NextAlertAt = null;
        task.AlertCount = 0;
    }
}

// Translates the user/AI-supplied reminder rule ("her saat", "1 saat once",
// "her 30 dakika", "günde bir", "15:00'dan 17:00'a kadar saat başı", etc.)
// into a concrete alert schedule. Unrecognized text falls back to the default
// 5/4/3/2/1/0 hour ladder so existing tasks keep working.
static List<(DateTimeOffset ScheduledFor, string Kind)> BuildAlertSchedule(string? reminderInterval, DateTimeOffset dueAt, DateTimeOffset now, int defaultLeadMinutes = 0)
{
    var raw = (reminderInterval ?? "").Trim();
    var entries = new List<(DateTimeOffset ScheduledFor, string Kind)>();

    // The lookup is intentionally tolerant: lowercase + Turkish-aware case fold so
    // "Her Saat", "her saat" and "HER SAAT" all match the same rule.
    var normalized = raw.ToLowerInvariant();

    // Pattern 1: explicit "HH:MM'dan HH:MM'a kadar saat başı" / "every hour from HH:MM until HH:MM".
    var windowMatch = Regex.Match(raw, @"(?<start>\d{1,2}:\d{2}).*?(?<end>\d{1,2}:\d{2})", RegexOptions.IgnoreCase);
    var mentionsHourly = normalized.Contains("saat başı") || normalized.Contains("saat basi")
        || normalized.Contains("her saat") || normalized.Contains("every hour")
        || normalized.Contains("hourly");
    if (windowMatch.Success && mentionsHourly
        && TimeOnly.TryParse(windowMatch.Groups["start"].Value, out var winStart)
        && TimeOnly.TryParse(windowMatch.Groups["end"].Value, out var winEnd))
    {
        var date = AppTime.UserToday(dueAt);
        var startAt = AppTime.ToInstant(date, winStart);
        var endAt = AppTime.ToInstant(date, winEnd);
        if (endAt <= startAt) endAt = endAt.AddDays(1);
        for (var cursor = startAt; cursor <= endAt; cursor = cursor.AddHours(1))
        {
            if (cursor > now) entries.Add((cursor, "interval"));
        }
        if (entries.Count > 0) return entries;
    }

    // Pattern 2: "her N dakika" / "every N minutes".
    var minutesMatch = Regex.Match(normalized, @"(?:her|every)\s+(?<n>\d{1,3})\s*(?:dakika|dk|minute|minutes|min)");
    if (minutesMatch.Success && int.TryParse(minutesMatch.Groups["n"].Value, out var minuteStep) && minuteStep > 0)
    {
        AddRepeatingLeadIn(entries, dueAt, now, TimeSpan.FromMinutes(minuteStep), maxLeadHours: 6);
        TryAddDue(entries, dueAt, now);
        return entries;
    }

    // Pattern 3: "her N saat" / "every N hours".
    var hoursMatch = Regex.Match(normalized, @"(?:her|every)\s+(?<n>\d{1,3})\s*(?:saat|hour|hours|hr|hrs)");
    if (hoursMatch.Success && int.TryParse(hoursMatch.Groups["n"].Value, out var hourStep) && hourStep > 0)
    {
        AddRepeatingLeadIn(entries, dueAt, now, TimeSpan.FromHours(hourStep), maxLeadHours: hourStep * 6);
        TryAddDue(entries, dueAt, now);
        return entries;
    }

    // Pattern 4: bare "her saat" / "every hour" / "saat başı" without a window → 1h step for 6 hours lead.
    if (mentionsHourly)
    {
        AddRepeatingLeadIn(entries, dueAt, now, TimeSpan.FromHours(1), maxLeadHours: 6);
        TryAddDue(entries, dueAt, now);
        return entries;
    }

    // Pattern 5: "günde bir" / "daily" / "her gün" → 3 daily nudges then due-time.
    if (normalized.Contains("günde bir") || normalized.Contains("gunde bir")
        || normalized.Contains("daily") || normalized.Contains("her gün") || normalized.Contains("her gun")
        || normalized.Contains("everyday") || normalized.Contains("every day"))
    {
        for (var daysBefore = 3; daysBefore >= 1; daysBefore--)
        {
            var at = dueAt.AddDays(-daysBefore);
            if (at > now) entries.Add((at, $"{daysBefore}d"));
        }
        TryAddDue(entries, dueAt, now);
        return entries;
    }

    // Pattern 6: "N saat önce" / "N hours before" → single lead alert + due.
    var leadMatch = Regex.Match(normalized, @"(?<n>\d{1,3})\s*(?:saat\s*(?:önce|once)|hours?\s*before|h\s*before)");
    if (leadMatch.Success && int.TryParse(leadMatch.Groups["n"].Value, out var leadHours) && leadHours > 0)
    {
        var at = dueAt.AddHours(-leadHours);
        if (at > now) entries.Add((at, $"{leadHours}h"));
        TryAddDue(entries, dueAt, now);
        return entries;
    }

    // Pattern 6b: "N dakika önce" / "N minutes before" → tekil dakika bazlı uyarı + vade (R10).
    var minuteLeadMatch = Regex.Match(normalized, @"(?<n>\d{1,4})\s*(?:dakika|dk|min)\s*(?:önce|once)|(?<n2>\d{1,4})\s*(?:minutes?|mins?)\s*before");
    if (minuteLeadMatch.Success)
    {
        var value = minuteLeadMatch.Groups["n"].Success ? minuteLeadMatch.Groups["n"].Value : minuteLeadMatch.Groups["n2"].Value;
        if (int.TryParse(value, out var leadMinutes) && leadMinutes > 0)
        {
            var at = dueAt.AddMinutes(-leadMinutes);
            if (at > now) entries.Add((at, $"{leadMinutes}m"));
            TryAddDue(entries, dueAt, now);
            return entries;
        }
    }

    // Kural yoksa/parse edilemediyse: kullanıcının varsayılan "N dakika önce" ayarı
    // merdivenin yerine geçer (R10 — süreyi müşteri kendisi belirler).
    if (defaultLeadMinutes > 0)
    {
        var at = dueAt.AddMinutes(-defaultLeadMinutes);
        if (at > now) entries.Add((at, $"{defaultLeadMinutes}m"));
        TryAddDue(entries, dueAt, now);
        return entries;
    }

    // Default fallback: original 5/4/3/2/1/0 hour ladder.
    foreach (var offset in new[] { 5, 4, 3, 2, 1, 0 })
    {
        var scheduledFor = offset == 0 ? dueAt : dueAt.AddHours(-offset);
        if (scheduledFor > now)
        {
            entries.Add((scheduledFor, offset == 0 ? "due" : $"{offset}h"));
        }
    }
    return entries;
}

static void AddRepeatingLeadIn(List<(DateTimeOffset ScheduledFor, string Kind)> entries, DateTimeOffset dueAt, DateTimeOffset now, TimeSpan step, int maxLeadHours)
{
    var leadWindow = TimeSpan.FromHours(Math.Max(1, maxLeadHours));
    var startAt = dueAt - leadWindow;
    for (var cursor = startAt; cursor < dueAt; cursor += step)
    {
        if (cursor > now) entries.Add((cursor, "interval"));
    }
}

static void TryAddDue(List<(DateTimeOffset ScheduledFor, string Kind)> entries, DateTimeOffset dueAt, DateTimeOffset now)
{
    if (dueAt > now) entries.Add((dueAt, "due"));
}

// Sınıflardan da (NotificationDispatcher, DigestService) erişilebilmesi için asıl
// mantık TaskLogic yardımcı sınıfında; buradaki sarmalayıcılar mevcut çağrıları korur.
static DateTimeOffset? ParseTaskDueAt(BusinessTaskEntity task) => TaskLogic.ParseTaskDueAt(task);

static string GetEffectiveTaskStatus(BusinessTaskEntity task, DateTimeOffset? now = null) => TaskLogic.GetEffectiveTaskStatus(task, now);

static bool TryShiftTaskDueTime(BusinessTaskEntity task, int hours)
{
    var dueAt = ParseTaskDueAt(task);
    if (dueAt is null)
    {
        return false;
    }

    var shifted = dueAt.Value.AddHours(hours);
    // Write the wall-clock back in the user's timezone (Istanbul), matching how it was authored.
    var userLocal = AppTime.UserLocal(shifted);
    task.DueDate = DateOnly.FromDateTime(userLocal).ToString("yyyy-MM-dd");
    task.DueTime = TimeOnly.FromDateTime(userLocal).ToString("HH:mm");
    task.NotificationsEnabled = true;
    return true;
}

static string HashToken(string value)
{
    var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
    return Convert.ToHexString(bytes);
}

static async Task NormalizeLegacyModules(ArxTaskDbContext db, string userId)
{
    var legacyIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "module-todo",
        "module-visits",
        "module-calls",
        "module-offers",
        "module-invoices",
        "module-installation",
        "module-removal",
        "module-repair",
        "module-support",
        "module-payments",
        "module-projects",
        "module-delivery",
        "module-measurements"
    };

    var modules = await db.Modules.Where(item => item.UserId == userId).ToListAsync();
    var tasks = await db.Tasks.Where(item => item.UserId == userId).ToListAsync();
    var usedModuleIds = tasks
        .SelectMany(item => item.ModuleIds.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    foreach (var module in modules)
    {
        if (!legacyIds.Contains(module.Id))
        {
            continue;
        }

        if (!usedModuleIds.Contains(module.Id))
        {
            db.Modules.Remove(module);
            continue;
        }

        module.IsPinnedToSidebar = true;
    }

    if (db.ChangeTracker.HasChanges())
    {
        await db.SaveChangesAsync();
    }
}

static string ExistingModuleType(string? value)
{
    var normalized = (value ?? "").Trim().ToLowerInvariant();
    return normalized switch
    {
        "visits" or "visit" => "visits",
        "calls" or "call" => "calls",
        "offers" or "offer" => "offers",
        "invoices" or "invoice" => "invoices",
        "installation" or "install" => "installation",
        "removal" => "removal",
        "repair" => "repair",
        "support" => "support",
        "payments" or "payment" => "payments",
        "projects" or "project" => "projects",
        "delivery" => "delivery",
        "measurements" or "measurement" => "measurements",
        "todo" or "to do" => "todo",
        _ => "custom"
    };
}

static string NormalizePriority(string? value)
{
    var normalized = (value ?? "").Trim().ToLowerInvariant();
    return normalized is "low" or "medium" or "high" ? normalized : "medium";
}

static string NormalizeLanguage(string? value)
{
    var normalized = (value ?? "").Trim().ToLowerInvariant();
    return normalized is "en" or "de" or "tr" or "ar" or "fr" or "nl" ? normalized : "en";
}

static string? NormalizeDate(string? value) =>
    DateOnly.TryParse(value, out var date) ? date.ToString("yyyy-MM-dd") : null;

static string? NormalizeTime(string? value) =>
    TimeOnly.TryParse(value, out var time) ? time.ToString("HH:mm") : null;

static double Clamp(double value) => Math.Max(0, Math.Min(1, value));

static JsonSerializerOptions JsonOptions() => new()
{
    PropertyNameCaseInsensitive = true,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

static async Task<AppSnapshot> BuildSnapshot(ArxTaskDbContext db, string userId)
{
    await NormalizeLegacyModules(db, userId);
    var modules = await db.Modules.Where(item => item.UserId == userId).OrderBy(item => item.Name).ToListAsync();
    var tasks = await db.Tasks.Where(item => item.UserId == userId).OrderBy(item => item.DueDate).ToListAsync();
    var reminders = await db.Reminders.Where(item => item.UserId == userId).OrderBy(item => item.StartTime).ToListAsync();
    var alerts = await db.TaskAlerts.Where(item => item.UserId == userId && item.Status == "pending").ToListAsync();
    foreach (var task in tasks)
    {
        task.Status = GetEffectiveTaskStatus(task);
    }
    foreach (var module in modules)
    {
        module.TaskCount = tasks.Count(task => task.Status != "done" && task.ModuleIds.Split(',', StringSplitOptions.RemoveEmptyEntries).Contains(module.Id));
    }
    foreach (var task in tasks)
    {
        var taskAlerts = alerts.Where(item => item.TaskId == task.Id).OrderBy(item => item.ScheduledFor).ToList();
        task.AlertCount = taskAlerts.Count;
        task.NextAlertAt = taskAlerts.FirstOrDefault()?.ScheduledFor.ToString("O");
        task.NotificationsEnabled = reminders.Any(item => item.TaskId == task.Id && item.NotificationsEnabled && item.Status == "active");
    }

    return new AppSnapshot(
        await db.Companies.Where(item => item.UserId == userId).OrderBy(item => item.Name).ToListAsync(),
        modules,
        tasks,
        await db.Notes.Where(item => item.UserId == userId).OrderByDescending(item => item.Id).ToListAsync(),
        await db.Documents.Where(item => item.UserId == userId).OrderByDescending(item => item.Id).ToListAsync(),
        await db.Offers.Include(item => item.Items).Where(item => item.UserId == userId).OrderByDescending(item => item.OfferDate).ToListAsync(),
        await db.Invoices.Include(item => item.Items).Where(item => item.UserId == userId).OrderByDescending(item => item.InvoiceDate).ToListAsync(),
        await db.Products.Where(item => item.UserId == userId).OrderBy(item => item.Category).ThenBy(item => item.Name).ToListAsync(),
        reminders,
        await db.Timeline.Where(item => item.UserId == userId).OrderByDescending(item => item.Id).ToListAsync(),
        await db.Routes.Include(item => item.Stops).Where(item => item.UserId == userId).OrderByDescending(item => item.Date).ToListAsync()
    );
}

string CreateToken(AppUser user)
{
    var claims = new[]
    {
        new Claim(JwtRegisteredClaimNames.Sub, user.Id),
        new Claim(JwtRegisteredClaimNames.Email, user.Email),
        new Claim(ClaimTypes.NameIdentifier, user.Id),
        new Claim(ClaimTypes.Name, user.Name),
        new Claim("is_admin", user.IsAdmin ? "true" : "false"),
        new Claim("is_system_admin", user.IsSystemAdmin ? "true" : "false")
    };
    var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)), SecurityAlgorithms.HmacSha256);
    var token = new JwtSecurityToken(jwtIssuer, jwtAudience, claims, expires: DateTime.UtcNow.AddDays(14), signingCredentials: credentials);
    return new JwtSecurityTokenHandler().WriteToken(token);
}

static TimelineEntryEntity Timeline(string userId, string companyId, string type, string title, string description, string relatedId) => new()
{
    Id = NewId("timeline"),
    UserId = userId,
    CompanyId = companyId,
    Type = type,
    Title = title,
    Description = description,
    Date = DateTimeOffset.UtcNow,
    RelatedId = relatedId
};

static void RecalculateOffer(OfferEntity offer)
{
    // Derive each line total from Quantity × UnitPrice rather than trusting the client-supplied
    // TotalPrice, so a bad/forged line total cannot desync the document header from its items.
    foreach (var item in offer.Items)
    {
        item.TotalPrice = Math.Round(item.Quantity * item.UnitPrice, 2);
    }
    offer.Subtotal = offer.Items.Sum(item => item.TotalPrice);
    offer.VatAmount = Math.Round(offer.Subtotal * offer.VatRate, 2);
    offer.Total = Math.Round(offer.Subtotal + offer.VatAmount, 2);
}

static void RecalculateInvoice(InvoiceEntity invoice)
{
    foreach (var item in invoice.Items)
    {
        item.TotalPrice = Math.Round(item.Quantity * item.UnitPrice, 2);
    }
    invoice.Subtotal = invoice.Items.Sum(item => item.TotalPrice);
    invoice.Total = Math.Round(invoice.Subtotal + invoice.Subtotal * invoice.VatRate, 2);
}

static string NormalizeEmail(string value)
{
    var decoded = Uri.UnescapeDataString((value ?? "").Trim());
    return decoded.Trim().ToLowerInvariant();
}

static void NormalizeStoredData(ArxTaskDbContext db)
{
    var users = db.Users.ToList().OrderBy(item => item.CreatedAt).ToList();

    foreach (var user in users)
    {
        var normalizedEmail = NormalizeEmail(user.Email);
        var conflict = users.Any(item => item.Id != user.Id && NormalizeEmail(item.Email) == normalizedEmail);
        if (!conflict && !string.Equals(user.Email, normalizedEmail, StringComparison.Ordinal))
        {
            user.Email = normalizedEmail;
        }
    }

    foreach (var company in db.Companies)
    {
        var normalizedEmail = NormalizeEmail(company.Email);
        if (!string.Equals(company.Email, normalizedEmail, StringComparison.Ordinal))
        {
            company.Email = normalizedEmail;
        }
    }

    db.SaveChanges();
}

static async Task<List<CompanyDuplicateGroup>> BuildCompanyDuplicateReport(ArxTaskDbContext db, string userId)
{
    var companies = (await db.Companies
        .Where(item => item.UserId == userId)
        .ToListAsync())
        .OrderByDescending(item => item.UpdatedAt)
        .ToList();

    return companies
        .GroupBy(item => NormalizeCompanyLookup(item.Name))
        .Where(group => !string.IsNullOrWhiteSpace(group.Key) && group.Count() > 1)
        .Select(group => new CompanyDuplicateGroup(
            group.Key,
            group.Select(item => new CompanyDuplicateItem(
                item.Id,
                item.Name,
                item.Email,
                item.Address,
                item.UpdatedAt.ToString("O"))).ToList()))
        .OrderByDescending(group => group.Companies.Count)
        .ToList();
}

static string NewId(string prefix) => Ids.New(prefix);
static string Slug(string value) => string.Join("-", value.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries));
static string EntityPrefix(Type type) => type.Name.Replace("Entity", "", StringComparison.OrdinalIgnoreCase).ToLowerInvariant();

// ---------------------------------------------------------------------------
// Otomatik kategorizasyon (R1): manuel görevler de kategori kontrolünden geçer.
// ---------------------------------------------------------------------------

static async Task<IResult> CreateTaskWithAutoCategory(
    ClaimsPrincipal principal,
    BusinessTaskEntity input,
    ArxTaskDbContext db,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory)
{
    var userId = principal.UserId();
    input.Id = string.IsNullOrWhiteSpace(input.Id) ? NewId("task") : input.Id;
    input.UserId = userId;
    await ApplyAutoCategory(db, userId, input, configuration, httpClientFactory);
    db.Tasks.Add(input);

    var owner = await db.Users.FindAsync(userId);
    if (owner is not null)
    {
        await EnsureDefaultLeadReminder(db, owner, input);
    }
    var reminder = db.Reminders.Local.FirstOrDefault(item => item.UserId == userId && item.TaskId == input.Id)
        ?? await db.Reminders.FirstOrDefaultAsync(item => item.UserId == userId && item.TaskId == input.Id);
    await SyncTaskAlertsForTask(db, userId, input, reminder);
    await db.SaveChangesAsync();
    return Results.Ok(input);
}

// Görev zaten kategorize edilmişse dokunmaz; edilmemişse önce kural tabanlı,
// gerekirse AI destekli sınıflandırmayla mevcut modüle bağlar ya da yeni modül açar.
static async Task ApplyAutoCategory(ArxTaskDbContext db, string userId, BusinessTaskEntity task, IConfiguration configuration, IHttpClientFactory httpClientFactory)
{
    var currentModules = (task.ModuleIds ?? "")
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Where(id => !string.Equals(id, "module-todo", StringComparison.OrdinalIgnoreCase))
        .ToList();
    if (currentModules.Count > 0)
    {
        return;
    }

    var inferredType = ExistingModuleType(task.Type);
    if (inferredType is "todo" or "custom")
    {
        inferredType = InferTaskTypeFromText($"{task.Title} {task.Description}") ?? inferredType;
    }
    if (inferredType is "todo" or "custom")
    {
        var aiType = await ClassifyTaskWithOpenAi(db, userId, task, configuration, httpClientFactory);
        if (!string.IsNullOrWhiteSpace(aiType))
        {
            inferredType = ExistingModuleType(aiType);
        }
    }

    task.Type = inferredType;
    var moduleName = GetDefaultModuleName(inferredType, new AiTask(task.Title, task.Description, inferredType), "tr");
    var moduleId = $"module-{Slug(moduleName)}";
    var module = db.Modules.Local.FirstOrDefault(item =>
            item.UserId == userId &&
            (item.Id == moduleId || item.Name.Equals(moduleName, StringComparison.OrdinalIgnoreCase) || (item.Type == inferredType && inferredType != "custom" && inferredType != "todo")))
        ?? await db.Modules.FirstOrDefaultAsync(item =>
            item.UserId == userId &&
            (item.Id == moduleId || item.Name.ToLower() == moduleName.ToLower() || (item.Type == inferredType && inferredType != "custom" && inferredType != "todo")));

    if (module is null)
    {
        module = new WorkModuleEntity
        {
            Id = moduleId,
            UserId = userId,
            Name = moduleName,
            Type = inferredType,
            CreatedByAI = true,
            IsPinnedToSidebar = true,
            TaskCount = 0,
            CreatedAt = DateTimeOffset.UtcNow
        };
        db.Modules.Add(module);
    }
    task.ModuleIds = module.Id;
}

// Başlık/açıklamadaki anahtar kelimelerden görev tipini çıkarır (Türkçe + Almanca + İngilizce).
static string? InferTaskTypeFromText(string text)
{
    var normalized = NormalizeKeywordText(text);
    var rules = new (string Pattern, string Type)[]
    {
        (@"\bteklif|\bangebot|\boffer|\bfiyat teklif", "offers"),
        (@"\bfatura|\brechnung|\binvoice", "invoices"),
        (@"\bmontaj|\bkurulum|\binstall", "installation"),
        (@"\bolcum|\bolc(?:u|\b)|\bmessung|\bmeasure", "measurements"),
        (@"\bziyaret|\bugra|\bvisit|\bbesuch", "visits"),
        (@"\btelefon|\bcall\b|\banruf", "calls"),
        (@"\btamir|\bonarim|\brepair|\breparatur", "repair"),
        (@"\bteslim|\bdeliver|\bliefer", "delivery"),
        (@"\bodeme|\btahsilat|\bpayment|\bzahlung", "payments"),
        (@"\bsokum|\bdemontaj|\bremoval", "removal"),
        (@"\bdestek|\bsupport", "support"),
        (@"\bproje|\bproject", "projects")
    };
    foreach (var rule in rules)
    {
        if (Regex.IsMatch(normalized, rule.Pattern, RegexOptions.CultureInvariant))
        {
            return rule.Type;
        }
    }
    return null;
}

// Kurallar sonuç vermezse mevcut OpenAI entegrasyonuyla tip sınıflandırması (anahtar yoksa sessizce atlanır).
static async Task<string?> ClassifyTaskWithOpenAi(ArxTaskDbContext db, string userId, BusinessTaskEntity task, IConfiguration configuration, IHttpClientFactory httpClientFactory)
{
    var apiKey = configuration["OpenAI:ApiKey"];
    if (string.IsNullOrWhiteSpace(apiKey)) return null;
    try
    {
        var modules = await db.Modules.Where(item => item.UserId == userId).Select(item => new { item.Name, item.Type }).Take(40).ToListAsync();
        var model = configuration["OpenAI:ChatModel"] ?? "gpt-4o-mini";
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(new
        {
            model,
            temperature = 0,
            response_format = new { type = "json_object" },
            messages = new object[]
            {
                new { role = "system", content = "Classify the field-sales task into exactly one type from: todo, visits, calls, offers, invoices, installation, removal, repair, support, payments, projects, delivery, measurements, custom. Answer as {\"type\":\"...\"}." },
                new { role = "user", content = JsonSerializer.Serialize(new { title = task.Title, description = task.Description, existingModules = modules }) }
            }
        }), Encoding.UTF8, "application/json");
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(10);
        using var response = await client.SendAsync(request);
        if (!response.IsSuccessStatusCode) return null;
        var completion = JsonSerializer.Deserialize<ChatCompletionResponse>(await response.Content.ReadAsStringAsync(), JsonOptions());
        var content = completion?.Choices.FirstOrDefault()?.Message.Content;
        if (string.IsNullOrWhiteSpace(content)) return null;
        var node = JsonNode.Parse(ExtractFirstJsonObject(content) ?? content);
        return node?["type"]?.GetValue<string?>();
    }
    catch
    {
        return null;
    }
}

// Kullanıcının "N dakika önce" varsayılanı: vadesi olan göreve otomatik hatırlatıcı kurar (R10).
static async Task EnsureDefaultLeadReminder(ArxTaskDbContext db, AppUser owner, BusinessTaskEntity task)
{
    if (owner.DefaultReminderLeadMinutes <= 0 || string.IsNullOrWhiteSpace(task.DueDate)) return;
    var existing = db.Reminders.Local.FirstOrDefault(item => item.UserId == owner.Id && item.TaskId == task.Id)
        ?? await db.Reminders.FirstOrDefaultAsync(item => item.UserId == owner.Id && item.TaskId == task.Id);
    if (existing is not null) return;
    db.Reminders.Add(new ReminderEntity
    {
        Id = NewId("reminder"),
        UserId = owner.Id,
        TaskId = task.Id,
        StartTime = task.DueDate!,
        RepeatInterval = $"{owner.DefaultReminderLeadMinutes} dakika önce",
        ActiveUntilDone = true,
        Status = "active",
        NotificationsEnabled = true
    });
}

// ---------------------------------------------------------------------------
// Adres doğrulama / geocoding (R3): Google anahtarı varsa Google, yoksa Nominatim.
// ---------------------------------------------------------------------------

static async Task<bool> GeocodeCompanyAsync(CompanyEntity company, IConfiguration configuration, IHttpClientFactory httpClientFactory, bool force = false)
{
    var address = company.Address?.Trim();
    if (string.IsNullOrWhiteSpace(address)) return false;
    if (!force && company.AddressVerified && (company.Latitude != 0 || company.Longitude != 0)) return true;
    try
    {
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(8);
        var googleKey = configuration["Google:MapsApiKey"];
        if (!string.IsNullOrWhiteSpace(googleKey))
        {
            var url = $"https://maps.googleapis.com/maps/api/geocode/json?address={Uri.EscapeDataString(address)}&key={googleKey}";
            using var response = await client.GetAsync(url);
            if (response.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                if (doc.RootElement.TryGetProperty("results", out var results)
                    && results.ValueKind == JsonValueKind.Array
                    && results.GetArrayLength() > 0)
                {
                    var first = results[0];
                    company.FormattedAddress = first.TryGetProperty("formatted_address", out var formatted) ? formatted.GetString() ?? "" : "";
                    var location = first.GetProperty("geometry").GetProperty("location");
                    company.Latitude = location.GetProperty("lat").GetDouble();
                    company.Longitude = location.GetProperty("lng").GetDouble();
                    company.AddressVerified = true;
                    company.AddressVerifiedAt = DateTimeOffset.UtcNow.ToString("O");
                    return true;
                }
            }
            return false;
        }

        // Ücretsiz varsayılan: OpenStreetMap Nominatim (kullanım şartı: tanımlayıcı User-Agent).
        // Serbest biçimli Türkçe adreslerde ("133391 nolu sk no:4" gibi) birebir eşleşme çoğu
        // zaman bulunamıyor; kademeli sadeleştirme ile en azından mahalle/ilçe hassasiyetinde
        // doğru koordinat elde edilir — düz metnin Google Maps'te yanlış şehre düşmesini önler.
        var firstAttempt = true;
        foreach (var query in BuildGeocodeQueryCandidates(address))
        {
            if (!firstAttempt) await Task.Delay(1100); // Nominatim adil kullanım: ~1 istek/sn
            firstAttempt = false;
            var nominatimUrl = $"https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q={Uri.EscapeDataString(query)}";
            using var nominatimRequest = new HttpRequestMessage(HttpMethod.Get, nominatimUrl);
            nominatimRequest.Headers.TryAddWithoutValidation("User-Agent", "ArxTask/1.0 (info@menupanels.com)");
            using var nominatimResponse = await client.SendAsync(nominatimRequest);
            if (!nominatimResponse.IsSuccessStatusCode) continue;
            using var doc = JsonDocument.Parse(await nominatimResponse.Content.ReadAsStringAsync());
            if (doc.RootElement.ValueKind != JsonValueKind.Array || doc.RootElement.GetArrayLength() == 0) continue;
            var first = doc.RootElement[0];
            company.FormattedAddress = first.TryGetProperty("display_name", out var displayName) ? displayName.GetString() ?? "" : "";
            if (first.TryGetProperty("lat", out var lat) && double.TryParse(lat.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var latValue))
            {
                company.Latitude = latValue;
            }
            if (first.TryGetProperty("lon", out var lon) && double.TryParse(lon.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var lonValue))
            {
                company.Longitude = lonValue;
            }
            company.AddressVerified = company.Latitude != 0 || company.Longitude != 0;
            company.AddressVerifiedAt = company.AddressVerified ? DateTimeOffset.UtcNow.ToString("O") : null;
            return company.AddressVerified;
        }
    }
    catch
    {
        // Geocode başarısızlığı kayıt akışını engellemez — adres doğrulanmamış kalır.
    }
    return false;
}

// Geocode deneme sırası: tam adres → rakamlı sokak/kapı belirteçleri atılmış hali →
// "mahalle, ilçe, il" kaba hali. "Şahinbey/Gaziantep" gibi bölü yazımları virgüle çevrilir.
static IEnumerable<string> BuildGeocodeQueryCandidates(string address)
{
    address = address.Trim();
    if (string.IsNullOrWhiteSpace(address)) yield break;
    yield return address;

    var noiseTokens = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "nolu", "no", "sk", "sok", "sokak", "cad", "cadde", "cd", "blv", "bulvar", "bulvarı",
        "mah", "mahalle", "mahallesi", "apt", "kat", "daire", "blok"
    };
    var parts = address.Replace('/', ',')
        .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
        .Select(part => string.Join(' ', part
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(token => !token.Any(char.IsDigit) && !noiseTokens.Contains(token.TrimEnd(':', '.')))))
        .Where(part => part.Length > 1)
        .ToList();

    if (parts.Count > 0)
    {
        var simplified = string.Join(", ", parts);
        if (!string.Equals(simplified, address, StringComparison.OrdinalIgnoreCase))
        {
            yield return simplified;
        }
        if (parts.Count > 2)
        {
            var coarse = $"{parts[0]}, {parts[^2]}, {parts[^1]}";
            if (!string.Equals(coarse, simplified, StringComparison.OrdinalIgnoreCase))
            {
                yield return coarse;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Rota koridoru üzerinde alışveriş fırsatı (OpenStreetMap / Overpass).
// ---------------------------------------------------------------------------

static double HaversineMeters(double lat1, double lng1, double lat2, double lng2)
{
    static double Rad(double d) => d * Math.PI / 180;
    const double R = 6_371_000;
    var dLat = Rad(lat2 - lat1);
    var dLng = Rad(lng2 - lng1);
    var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
        + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
    return 2 * R * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
}

// OSRM ile gerçek yol geometrisini alır (koridor); başarısızsa verilen noktaları döndürür.
static async Task<List<(double Lat, double Lng)>> GetRouteCorridor(HttpClient client, List<(double Lat, double Lng)> points)
{
    if (points.Count < 2) return points;
    try
    {
        var coordStr = string.Join(";", points.Select(p =>
            $"{p.Lng.ToString(CultureInfo.InvariantCulture)},{p.Lat.ToString(CultureInfo.InvariantCulture)}"));
        var url = $"https://router.project-osrm.org/route/v1/driving/{coordStr}?overview=full&geometries=geojson";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("User-Agent", "ArxTask/1.0 (info@menupanels.com)");
        using var response = await client.SendAsync(request);
        if (response.IsSuccessStatusCode)
        {
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (doc.RootElement.TryGetProperty("routes", out var routes) && routes.GetArrayLength() > 0
                && routes[0].TryGetProperty("geometry", out var geom)
                && geom.TryGetProperty("coordinates", out var coords) && coords.ValueKind == JsonValueKind.Array)
            {
                var line = new List<(double, double)>();
                foreach (var c in coords.EnumerateArray())
                {
                    if (c.GetArrayLength() >= 2)
                    {
                        line.Add((c[1].GetDouble(), c[0].GetDouble())); // geojson [lng,lat] → (lat,lng)
                    }
                }
                if (line.Count >= 2) return line;
            }
        }
    }
    catch { /* OSRM erişilemezse düz çizgiye düş */ }
    return points;
}

// Koridor boyunca belirli aralıklarla örnek noktalar üretir (Overpass around yükünü sınırlar).
static List<(double Lat, double Lng)> SampleCorridorPoints(List<(double Lat, double Lng)> corridor, double spacingMeters, int maxPoints)
{
    var result = new List<(double, double)>();
    if (corridor.Count == 0) return result;
    result.Add(corridor[0]);
    double acc = 0;
    for (var i = 1; i < corridor.Count && result.Count < maxPoints; i++)
    {
        var d = HaversineMeters(corridor[i - 1].Lat, corridor[i - 1].Lng, corridor[i].Lat, corridor[i].Lng);
        acc += d;
        if (acc >= spacingMeters)
        {
            result.Add(corridor[i]);
            acc = 0;
        }
    }
    if (result.Count < maxPoints && corridor.Count > 1 && result[^1] != corridor[^1])
    {
        result.Add(corridor[^1]);
    }
    return result;
}

// Türkçe kategori → OpenStreetMap etiket seçicileri.
static List<string> CategoryToOsmSelectors(string category)
{
    var c = NormalizeKeywordText(category);
    if (c.Contains("kasap")) return ["[shop=butcher]"];
    if (c.Contains("manav") || c.Contains("sebze") || c.Contains("meyve")) return ["[shop=greengrocer]"];
    if (c.Contains("pastane") || c.Contains("tatli") || c.Contains("pasta")) return ["[shop=confectionery]", "[shop=pastry]", "[shop=bakery]"];
    if (c.Contains("firin") || c.Contains("ekmek")) return ["[shop=bakery]"];
    if (c.Contains("eczane")) return ["[amenity=pharmacy]"];
    if (c.Contains("kirtasiye")) return ["[shop=stationery]"];
    if (c.Contains("kitap")) return ["[shop=books]"];
    if (c.Contains("benzin") || c.Contains("akaryakit") || c.Contains("yakit")) return ["[amenity=fuel]"];
    if (c.Contains("elektronik")) return ["[shop=electronics]"];
    if (c.Contains("giyim") || c.Contains("tekstil")) return ["[shop=clothes]"];
    if (c.Contains("market") || c.Contains("supermarket") || c.Contains("bakkal") || c.Contains("gida") || c.Contains("alisveris"))
        return ["[shop=supermarket]", "[shop=convenience]"];
    // Kategori belirsizse geniş market taraması yap.
    return ["[shop=supermarket]", "[shop=convenience]"];
}

static async Task<List<OverpassPoi>> QueryOverpassAlongCorridor(HttpClient client, List<(double Lat, double Lng)> sampled, List<ShoppingItemEntity> items, double bufferMeters)
{
    if (sampled.Count == 0) return [];
    var around = $"around:{(int)bufferMeters}," + string.Join(",", sampled.Select(p =>
        $"{p.Lat.ToString(CultureInfo.InvariantCulture)},{p.Lng.ToString(CultureInfo.InvariantCulture)}"));

    // Seçicileri topla: zinciri olan madde → isim regex; olmayan → kategori etiketleri.
    var selectors = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var item in items)
    {
        if (!string.IsNullOrWhiteSpace(item.Chain))
        {
            var safe = Regex.Replace(item.Chain.Trim(), @"[^\p{L}\p{N}\s]", "");
            if (safe.Length >= 2) selectors.Add($"[\"name\"~\"{safe}\",i]");
            // Zincirler çoğunlukla markettir; Overpass regex'i Türkçe İ/I farkını yakalamayabildiği
            // için market kategorisini de ekle — sonuçlar isim eşlemesiyle (diakritik-katlamalı) filtrelenir.
            selectors.Add("[shop=supermarket]");
            selectors.Add("[shop=convenience]");
        }
        else
        {
            foreach (var sel in CategoryToOsmSelectors(item.Category)) selectors.Add(sel);
        }
    }
    if (selectors.Count == 0) return [];

    var body = new StringBuilder();
    body.Append("[out:json][timeout:25];(");
    foreach (var sel in selectors)
    {
        body.Append($"nwr{sel}({around});");
    }
    body.Append(");out center tags 120;");

    try
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://overpass-api.de/api/interpreter")
        {
            Content = new StringContent("data=" + Uri.EscapeDataString(body.ToString()), Encoding.UTF8, "application/x-www-form-urlencoded")
        };
        request.Headers.TryAddWithoutValidation("User-Agent", "ArxTask/1.0 (info@menupanels.com)");
        // Accept başlığı olmadan Overpass 406 döndürüyor.
        request.Headers.TryAddWithoutValidation("Accept", "application/json");
        using var response = await client.SendAsync(request);
        if (!response.IsSuccessStatusCode) return [];
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        if (!doc.RootElement.TryGetProperty("elements", out var elements) || elements.ValueKind != JsonValueKind.Array) return [];
        var pois = new List<OverpassPoi>();
        foreach (var el in elements.EnumerateArray())
        {
            double lat, lng;
            if (el.TryGetProperty("lat", out var latEl) && el.TryGetProperty("lon", out var lonEl))
            {
                lat = latEl.GetDouble(); lng = lonEl.GetDouble();
            }
            else if (el.TryGetProperty("center", out var center) && center.TryGetProperty("lat", out var clat) && center.TryGetProperty("lon", out var clon))
            {
                lat = clat.GetDouble(); lng = clon.GetDouble();
            }
            else continue;

            var tags = el.TryGetProperty("tags", out var t) ? t : default;
            var name = tags.ValueKind == JsonValueKind.Object && tags.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
            var shopTag = "";
            if (tags.ValueKind == JsonValueKind.Object)
            {
                if (tags.TryGetProperty("shop", out var s)) shopTag = s.GetString() ?? "";
                else if (tags.TryGetProperty("amenity", out var am)) shopTag = am.GetString() ?? "";
            }
            if (string.IsNullOrWhiteSpace(name)) continue; // isimsiz POI'leri atla
            pois.Add(new OverpassPoi(name, lat, lng, shopTag));
        }
        // İsim+konuma göre tekilleştir.
        return pois
            .GroupBy(p => $"{p.Name.ToLowerInvariant()}|{Math.Round(p.Lat, 4)}|{Math.Round(p.Lng, 4)}")
            .Select(g => g.First())
            .ToList();
    }
    catch { return []; }
}

static List<ErrandMatch> MatchPoisToItems(List<OverpassPoi> pois, List<ShoppingItemEntity> items, List<(double Lat, double Lng)> corridor)
{
    var matches = new List<ErrandMatch>();
    foreach (var poi in pois)
    {
        // Bu POI'yi karşılayan ilk maddeyi bul.
        ShoppingItemEntity? matched = null;
        foreach (var item in items)
        {
            if (!string.IsNullOrWhiteSpace(item.Chain))
            {
                if (NormalizeCompanyFold(poi.Name).Contains(NormalizeCompanyFold(item.Chain), StringComparison.Ordinal))
                {
                    matched = item; break;
                }
            }
            else
            {
                var tag = $"[shop={poi.ShopTag}]";
                var amenityTag = $"[amenity={poi.ShopTag}]";
                if (CategoryToOsmSelectors(item.Category).Any(sel => sel == tag || sel == amenityTag))
                {
                    matched = item; break;
                }
            }
        }
        if (matched is null) continue;

        // Rotaya en yakın mesafe (koridor noktalarına en küçük uzaklık).
        var minDist = corridor.Count == 0 ? 0 : corridor.Min(c => HaversineMeters(poi.Lat, poi.Lng, c.Lat, c.Lng));
        matches.Add(new ErrandMatch(matched.Id, matched.Name, poi.Name, matched.Category, matched.Chain, poi.Lat, poi.Lng, minDist));
    }
    return matches;
}

// ---------------------------------------------------------------------------
// PDF üretimi (QuestPDF): teklif/fatura anteti + kalem tablosu + toplamlar.
// ---------------------------------------------------------------------------

static string SanitizeFileName(string value)
{
    var cleaned = string.Join("-", (value ?? "belge").Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries)).Trim('-');
    return string.IsNullOrWhiteSpace(cleaned) ? "belge" : cleaned;
}

static byte[] BuildSalesDocumentPdf(
    string title,
    string documentNumber,
    string documentDate,
    string secondaryLine,
    CompanyEntity? company,
    AppUser? seller,
    List<(string ProductName, string Description, decimal Quantity, decimal UnitPrice, decimal TotalPrice)> items,
    decimal subtotal,
    decimal vatRate,
    decimal total,
    string currency,
    string notes)
{
    var culture = CultureInfo.GetCultureInfo("de-DE");
    string Money(decimal value) => $"{value.ToString("N2", culture)} {currency}";
    var sellerName = string.IsNullOrWhiteSpace(seller?.CompanyName) ? (seller?.Name ?? "") : seller!.CompanyName;

    return Document.Create(container =>
    {
        container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(40);
            page.DefaultTextStyle(style => style.FontSize(10));

            page.Header().Row(row =>
            {
                row.RelativeItem().Column(column =>
                {
                    column.Item().Text(sellerName).FontSize(16).SemiBold();
                    if (!string.IsNullOrWhiteSpace(seller?.CompanyAddress))
                    {
                        column.Item().Text(seller!.CompanyAddress).FontColor(Colors.Grey.Darken1);
                    }
                    var contactLine = string.Join(" · ", new[] { seller?.CompanyPhone, seller?.CompanyEmail }.Where(item => !string.IsNullOrWhiteSpace(item)));
                    if (!string.IsNullOrWhiteSpace(contactLine))
                    {
                        column.Item().Text(contactLine).FontColor(Colors.Grey.Darken1);
                    }
                });
                row.ConstantItem(210).Column(column =>
                {
                    column.Item().AlignRight().Text(title).FontSize(14).SemiBold();
                    column.Item().AlignRight().Text(documentNumber);
                    column.Item().AlignRight().Text($"Tarih: {documentDate}");
                    if (!string.IsNullOrWhiteSpace(secondaryLine))
                    {
                        column.Item().AlignRight().Text(secondaryLine).FontColor(Colors.Grey.Darken1);
                    }
                });
            });

            page.Content().PaddingVertical(20).Column(column =>
            {
                if (company is not null)
                {
                    column.Item().PaddingBottom(14).Column(buyer =>
                    {
                        buyer.Item().Text("Müşteri / Kunde").FontSize(8).FontColor(Colors.Grey.Darken1);
                        buyer.Item().Text(company.Name).SemiBold();
                        var buyerAddress = string.IsNullOrWhiteSpace(company.FormattedAddress) ? company.Address : company.FormattedAddress;
                        if (!string.IsNullOrWhiteSpace(buyerAddress)) buyer.Item().Text(buyerAddress);
                        if (!string.IsNullOrWhiteSpace(company.ContactPerson)) buyer.Item().Text(company.ContactPerson);
                    });
                }

                column.Item().Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(5);
                        columns.RelativeColumn(2);
                        columns.RelativeColumn(2);
                        columns.RelativeColumn(2);
                    });
                    table.Header(header =>
                    {
                        static IContainer HeaderCell(IContainer cell) => cell.BorderBottom(1).BorderColor(Colors.Grey.Darken2).PaddingVertical(4);
                        header.Cell().Element(HeaderCell).Text("Ürün / Hizmet").SemiBold();
                        header.Cell().Element(HeaderCell).AlignRight().Text("Adet").SemiBold();
                        header.Cell().Element(HeaderCell).AlignRight().Text("Birim Fiyat").SemiBold();
                        header.Cell().Element(HeaderCell).AlignRight().Text("Toplam").SemiBold();
                    });
                    foreach (var item in items)
                    {
                        static IContainer BodyCell(IContainer cell) => cell.BorderBottom(1).BorderColor(Colors.Grey.Lighten2).PaddingVertical(4);
                        table.Cell().Element(BodyCell).Column(cellColumn =>
                        {
                            cellColumn.Item().Text(string.IsNullOrWhiteSpace(item.ProductName) ? "-" : item.ProductName);
                            if (!string.IsNullOrWhiteSpace(item.Description))
                            {
                                cellColumn.Item().Text(item.Description).FontSize(8).FontColor(Colors.Grey.Darken1);
                            }
                        });
                        table.Cell().Element(BodyCell).AlignRight().Text(item.Quantity.ToString("0.##", CultureInfo.InvariantCulture));
                        table.Cell().Element(BodyCell).AlignRight().Text(Money(item.UnitPrice));
                        table.Cell().Element(BodyCell).AlignRight().Text(Money(item.TotalPrice));
                    }
                });

                column.Item().AlignRight().PaddingTop(10).Column(totals =>
                {
                    totals.Item().Text($"Ara toplam: {Money(subtotal)}");
                    totals.Item().Text($"KDV (%{(vatRate * 100).ToString("0.#", CultureInfo.InvariantCulture)}): {Money(total - subtotal)}");
                    totals.Item().Text($"Genel toplam: {Money(total)}").FontSize(12).SemiBold();
                });

                if (!string.IsNullOrWhiteSpace(notes))
                {
                    column.Item().PaddingTop(16).Column(noteColumn =>
                    {
                        noteColumn.Item().Text("Notlar").FontSize(8).FontColor(Colors.Grey.Darken1);
                        noteColumn.Item().Text(notes).FontSize(9);
                    });
                }
            });

            page.Footer().Column(footer =>
            {
                var bankLine = string.Join(" · ", new[]
                {
                    string.IsNullOrWhiteSpace(seller?.CompanyTaxId) ? null : $"Vergi No: {seller!.CompanyTaxId}",
                    string.IsNullOrWhiteSpace(seller?.CompanyIban) ? null : $"IBAN: {seller!.CompanyIban}"
                }.Where(item => item is not null));
                if (!string.IsNullOrWhiteSpace(bankLine))
                {
                    footer.Item().AlignCenter().Text(bankLine).FontSize(8).FontColor(Colors.Grey.Darken1);
                }
                footer.Item().AlignCenter().Text(text =>
                {
                    text.DefaultTextStyle(style => style.FontSize(8));
                    text.Span("Sayfa ");
                    text.CurrentPageNumber();
                    text.Span(" / ");
                    text.TotalPages();
                });
            });
        });
    }).GeneratePdf();
}

// Taranan formdan çıkarılan alanlarla doldurulmuş temiz bir PDF (R18).
static byte[] BuildFilledFormPdf(DocumentEntity document)
{
    var fields = new List<(string Label, string Value)>();
    if (!string.IsNullOrWhiteSpace(document.FieldsJson))
    {
        try
        {
            if (JsonNode.Parse(document.FieldsJson) is JsonArray array)
            {
                foreach (var entry in array)
                {
                    if (entry is not JsonObject obj) continue;
                    var label = obj["label"]?.GetValue<string?>() ?? "";
                    var value = obj["value"]?.GetValue<string?>();
                    if (string.IsNullOrWhiteSpace(value)) value = obj["suggestedValue"]?.GetValue<string?>() ?? "";
                    if (!string.IsNullOrWhiteSpace(label)) fields.Add((label, value ?? ""));
                }
            }
        }
        catch
        {
        }
    }

    return Document.Create(container =>
    {
        container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(40);
            page.DefaultTextStyle(style => style.FontSize(10));
            page.Header().Column(column =>
            {
                column.Item().Text("Doldurulmuş Form").FontSize(16).SemiBold();
                column.Item().Text($"Kaynak: {document.FileName} · {document.DocumentType}").FontSize(9).FontColor(Colors.Grey.Darken1);
            });
            page.Content().PaddingVertical(16).Column(column =>
            {
                if (fields.Count > 0)
                {
                    column.Item().Table(table =>
                    {
                        table.ColumnsDefinition(columns =>
                        {
                            columns.RelativeColumn(2);
                            columns.RelativeColumn(3);
                        });
                        foreach (var field in fields)
                        {
                            table.Cell().BorderBottom(1).BorderColor(Colors.Grey.Lighten2).PaddingVertical(5).Text(field.Label).SemiBold();
                            table.Cell().BorderBottom(1).BorderColor(Colors.Grey.Lighten2).PaddingVertical(5)
                                .Text(string.IsNullOrWhiteSpace(field.Value) ? "________________" : field.Value);
                        }
                    });
                }
                else
                {
                    column.Item().Text("Bu belge için çıkarılmış form alanı yok.").FontColor(Colors.Grey.Darken1);
                }
                if (!string.IsNullOrWhiteSpace(document.ExtractedText))
                {
                    column.Item().PaddingTop(16).Text("Belge metni").FontSize(8).FontColor(Colors.Grey.Darken1);
                    column.Item().Text(Truncate(document.ExtractedText, 6000)).FontSize(8);
                }
            });
        });
    }).GeneratePdf();
}

// ---------------------------------------------------------------------------
// Dosya yükleme (R17, R18).
// ---------------------------------------------------------------------------

static async Task<(StoredFileEntity? File, string? Error)> SaveUploadedFileAsync(
    IFormFile? file,
    string? kind,
    string? relatedId,
    string userId,
    ArxTaskDbContext db,
    IWebHostEnvironment environment)
{
    if (file is null || file.Length == 0) return (null, "Dosya boş.");
    if (file.Length > 15 * 1024 * 1024) return (null, "Dosya 15 MB sınırını aşıyor.");
    var allowed = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["image/jpeg"] = ".jpg",
        ["image/png"] = ".png",
        ["image/webp"] = ".webp",
        ["image/heic"] = ".heic",
        ["application/pdf"] = ".pdf"
    };
    if (!allowed.TryGetValue(file.ContentType ?? "", out var extension))
    {
        return (null, "Yalnızca JPG, PNG, WEBP, HEIC veya PDF yüklenebilir.");
    }

    var id = NewId("file");
    var directory = Path.Combine(environment.ContentRootPath, "uploads", userId);
    Directory.CreateDirectory(directory);
    var storagePath = Path.Combine(directory, id + extension);
    await using (var stream = File.Create(storagePath))
    {
        await file.CopyToAsync(stream);
    }

    var stored = new StoredFileEntity
    {
        Id = id,
        UserId = userId,
        FileName = string.IsNullOrWhiteSpace(file.FileName) ? id + extension : file.FileName,
        ContentType = file.ContentType ?? "application/octet-stream",
        Size = file.Length,
        StoragePath = storagePath,
        Kind = string.IsNullOrWhiteSpace(kind) ? "photo" : kind!.Trim(),
        RelatedId = relatedId,
        CreatedAt = DateTimeOffset.UtcNow
    };
    db.StoredFiles.Add(stored);
    await db.SaveChangesAsync();
    return (stored, null);
}

static object? TryParseJson(string? json)
{
    if (string.IsNullOrWhiteSpace(json)) return null;
    try
    {
        return JsonSerializer.Deserialize<JsonElement>(json);
    }
    catch
    {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Haftalık analiz (R12): rota geçmişi + ziyaretler + iş özetleri.
// ---------------------------------------------------------------------------

static async Task<object> BuildWeeklyAnalysis(ArxTaskDbContext db, string userId, string? weekStart)
{
    var now = DateTimeOffset.Now;
    var today = AppTime.UserToday(now);
    var start = DateOnly.TryParse(weekStart, out var parsed)
        ? parsed
        : today.AddDays(-(((int)today.DayOfWeek + 6) % 7)); // haftanın pazartesisi
    var end = start.AddDays(6);
    var startText = start.ToString("yyyy-MM-dd");
    var endText = end.ToString("yyyy-MM-dd");

    var companies = await db.Companies.Where(item => item.UserId == userId).ToListAsync();
    var companyNames = companies.GroupBy(item => item.Id).ToDictionary(group => group.Key, group => group.First().Name);
    var tasks = await db.Tasks.Where(item => item.UserId == userId).ToListAsync();
    var offers = await db.Offers.Where(item => item.UserId == userId).ToListAsync();
    var invoices = await db.Invoices.Where(item => item.UserId == userId).ToListAsync();
    var routes = await db.Routes.Include(item => item.Stops).Where(item => item.UserId == userId).ToListAsync();
    var visits = (await db.CompanyVisits.Where(item => item.UserId == userId).ToListAsync())
        .Where(item =>
        {
            var visitDate = AppTime.UserToday(item.VisitedAt);
            return visitDate >= start && visitDate <= end;
        })
        .OrderBy(item => item.VisitedAt)
        .ToList();

    bool InWeek(string? isoTimestamp) =>
        !string.IsNullOrWhiteSpace(isoTimestamp)
        && DateTimeOffset.TryParse(isoTimestamp, out var at)
        && AppTime.UserToday(at) >= start
        && AppTime.UserToday(at) <= end;

    var weekRoutes = routes
        .Where(item => string.CompareOrdinal(item.Date, startText) >= 0 && string.CompareOrdinal(item.Date, endText) <= 0)
        .OrderBy(item => item.Date)
        .ToList();
    var completedTasks = tasks.Where(item => item.Status == "done" && InWeek(item.CompletedAt)).ToList();
    var overdueTasks = tasks
        .Where(item => GetEffectiveTaskStatus(item, now) == "overdue")
        .Select(item => new
        {
            id = item.Id,
            title = item.Title,
            company = item.CompanyId is not null ? companyNames.GetValueOrDefault(item.CompanyId) : null,
            dueDate = item.DueDate,
            dueTime = item.DueTime,
            delayHours = ParseTaskDueAt(item) is { } dueAt ? Math.Max(0, (int)(now - dueAt).TotalHours) : 0,
            delayReason = item.DelayReason ?? "",
            recurring = item.RepeatUntilDone
        })
        .OrderByDescending(item => item.delayHours)
        .ToList();

    var visitsByCompany = visits
        .GroupBy(item => item.CompanyId)
        .Select(group => new
        {
            companyId = group.Key,
            companyName = companyNames.GetValueOrDefault(group.Key, "?"),
            count = group.Count()
        })
        .OrderByDescending(item => item.count)
        .ToList();

    return new
    {
        weekStart = startText,
        weekEnd = endText,
        totals = new
        {
            completedTasks = completedTasks.Count,
            overdueTasks = overdueTasks.Count,
            recurringOpenTasks = tasks.Count(item => item.RepeatUntilDone && item.Status != "done"),
            visits = visits.Count,
            routes = weekRoutes.Count,
            acceptedOffers = offers.Count(item =>
                (item.Status is "accepted" or "convertedToInvoice")
                && string.CompareOrdinal(item.OfferDate, startText) >= 0
                && string.CompareOrdinal(item.OfferDate, endText) <= 0),
            openOffers = offers.Count(item => item.Status is "draft" or "sent" or "prepared"),
            unpaidInvoiceTotal = invoices.Where(item => item.Status != "paid").Sum(item => item.Total),
            paidThisWeek = invoices.Where(item => item.Status == "paid" && InWeek(item.PaidAt)).Sum(item => item.Total)
        },
        routes = weekRoutes.Select(route => new
        {
            id = route.Id,
            date = route.Date,
            status = route.Status,
            source = route.Source,
            stops = route.Stops.OrderBy(stop => stop.Order).Select(stop => new
            {
                companyId = stop.CompanyId,
                companyName = companyNames.GetValueOrDefault(stop.CompanyId, "?"),
                visitedAt = stop.VisitedAt
            }).ToList()
        }).ToList(),
        visitsByCompany,
        overdueTasks,
        visitLog = visits.Select(item => new
        {
            id = item.Id,
            companyName = companyNames.GetValueOrDefault(item.CompanyId, "?"),
            source = item.Source,
            visitedAt = item.VisitedAt.ToString("O"),
            routeId = item.RouteId
        }).ToList()
    };
}

// ---------------------------------------------------------------------------
// Linkten ürün çıkarma (R7): JSON-LD + OpenGraph, gerekirse OpenAI ile.
// ---------------------------------------------------------------------------

static bool IsPrivateHost(Uri uri)
{
    var host = uri.Host.ToLowerInvariant();
    if (host is "localhost" || host.EndsWith(".local", StringComparison.Ordinal) || host.EndsWith(".internal", StringComparison.Ordinal))
    {
        return true;
    }
    if (System.Net.IPAddress.TryParse(host, out var ip))
    {
        var bytes = ip.GetAddressBytes();
        if (bytes.Length != 4) return true; // IPv6 literal hedefler engellenir
        return bytes[0] == 10
            || bytes[0] == 127
            || (bytes[0] == 192 && bytes[1] == 168)
            || (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
            || (bytes[0] == 169 && bytes[1] == 254)
            || bytes[0] == 0;
    }
    return false;
}

static async Task<string> ReadBoundedStringAsync(HttpResponseMessage response, int maxBytes)
{
    await using var stream = await response.Content.ReadAsStreamAsync();
    using var memory = new MemoryStream();
    var buffer = new byte[16384];
    int read;
    while ((read = await stream.ReadAsync(buffer)) > 0)
    {
        memory.Write(buffer, 0, read);
        if (memory.Length >= maxBytes) break;
    }
    return Encoding.UTF8.GetString(memory.ToArray());
}

static decimal ParseScrapedPrice(string? raw)
{
    if (string.IsNullOrWhiteSpace(raw)) return 0;
    var cleaned = Regex.Replace(raw, @"[^\d.,]", "");
    if (cleaned.Length == 0) return 0;
    // "1.299,90" (Avrupa) → "1299.90"; "1,299.90" (ABD) → "1299.90"
    if (cleaned.Contains(',') && cleaned.Contains('.'))
    {
        cleaned = cleaned.LastIndexOf(',') > cleaned.LastIndexOf('.')
            ? cleaned.Replace(".", "").Replace(',', '.')
            : cleaned.Replace(",", "");
    }
    else if (cleaned.Contains(','))
    {
        cleaned = cleaned.Replace(',', '.');
    }
    return decimal.TryParse(cleaned, NumberStyles.Any, CultureInfo.InvariantCulture, out var value) ? Math.Round(value, 2) : 0;
}

static List<ScrapedProduct> ExtractProductsFromHtml(string html, Uri baseUri)
{
    var products = new List<ScrapedProduct>();

    string? AbsoluteUrl(string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate)) return null;
        return Uri.TryCreate(baseUri, candidate.Trim(), out var absolute) ? absolute.ToString() : null;
    }

    void CollectLdNode(JsonNode? node)
    {
        switch (node)
        {
            case JsonArray array:
                foreach (var child in array) CollectLdNode(child);
                break;
            case JsonObject obj:
                var typeNode = obj["@type"];
                var typeText = typeNode is JsonArray typeArray
                    ? string.Join(",", typeArray.Select(item => item?.GetValue<string?>() ?? ""))
                    : typeNode?.GetValue<string?>() ?? "";
                if (typeText.Contains("Product", StringComparison.OrdinalIgnoreCase))
                {
                    var name = obj["name"]?.GetValue<string?>();
                    if (!string.IsNullOrWhiteSpace(name))
                    {
                        decimal price = 0;
                        string? currency = null;
                        var offersNode = obj["offers"];
                        var offerObject = offersNode is JsonArray offerArray ? offerArray.FirstOrDefault() as JsonObject : offersNode as JsonObject;
                        if (offerObject is not null)
                        {
                            price = ParseScrapedPrice(offerObject["price"]?.ToString());
                            if (price == 0) price = ParseScrapedPrice((offerObject["priceSpecification"] as JsonObject)?["price"]?.ToString());
                            currency = offerObject["priceCurrency"]?.GetValue<string?>();
                        }
                        string? image = null;
                        var imageNode = obj["image"];
                        image = imageNode switch
                        {
                            JsonArray imageArray => imageArray.FirstOrDefault()?.GetValue<string?>(),
                            JsonObject imageObject => imageObject["url"]?.GetValue<string?>(),
                            JsonValue value => value.GetValue<string?>(),
                            _ => null
                        };
                        products.Add(new ScrapedProduct(name!.Trim(), price, currency, AbsoluteUrl(image)));
                    }
                }
                // @graph ve iç içe nesneleri de tara.
                foreach (var property in obj)
                {
                    if (property.Value is JsonArray or JsonObject) CollectLdNode(property.Value);
                }
                break;
        }
    }

    foreach (Match match in Regex.Matches(html, @"<script[^>]*type\s*=\s*[""']application/ld\+json[""'][^>]*>(?<json>[\s\S]*?)</script>", RegexOptions.IgnoreCase))
    {
        try
        {
            CollectLdNode(JsonNode.Parse(match.Groups["json"].Value.Trim()));
        }
        catch
        {
        }
    }

    if (products.Count == 0)
    {
        // OpenGraph tek ürün sayfası: og:title + product:price:amount + og:image.
        string? Meta(string property)
        {
            var metaMatch = Regex.Match(html,
                $@"<meta[^>]+(?:property|name)\s*=\s*[""']{Regex.Escape(property)}[""'][^>]+content\s*=\s*[""'](?<content>[^""']*)[""']",
                RegexOptions.IgnoreCase);
            if (metaMatch.Success) return System.Net.WebUtility.HtmlDecode(metaMatch.Groups["content"].Value);
            metaMatch = Regex.Match(html,
                $@"<meta[^>]+content\s*=\s*[""'](?<content>[^""']*)[""'][^>]+(?:property|name)\s*=\s*[""']{Regex.Escape(property)}[""']",
                RegexOptions.IgnoreCase);
            return metaMatch.Success ? System.Net.WebUtility.HtmlDecode(metaMatch.Groups["content"].Value) : null;
        }

        var ogTitle = Meta("og:title");
        var priceAmount = Meta("product:price:amount") ?? Meta("og:price:amount");
        if (!string.IsNullOrWhiteSpace(ogTitle) && !string.IsNullOrWhiteSpace(priceAmount))
        {
            products.Add(new ScrapedProduct(
                ogTitle!.Trim(),
                ParseScrapedPrice(priceAmount),
                Meta("product:price:currency") ?? Meta("og:price:currency"),
                AbsoluteUrl(Meta("og:image"))));
        }
    }

    // Aynı isimli tekrarları at.
    return products
        .Where(item => !string.IsNullOrWhiteSpace(item.Name))
        .GroupBy(item => item.Name.Trim(), StringComparer.OrdinalIgnoreCase)
        .Select(group => group.OrderByDescending(item => item.Price).First())
        .ToList();
}

static async Task<List<ScrapedProduct>> ExtractProductsWithOpenAi(string html, Uri uri, IConfiguration configuration, IHttpClientFactory httpClientFactory, string apiKey)
{
    try
    {
        var text = Regex.Replace(html, @"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, "<[^>]+>", " ");
        text = System.Net.WebUtility.HtmlDecode(Regex.Replace(text, @"\s+", " ")).Trim();
        if (text.Length > 12000) text = text[..12000];
        if (text.Length < 40) return [];

        var model = configuration["OpenAI:ChatModel"] ?? "gpt-4o-mini";
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(new
        {
            model,
            temperature = 0,
            response_format = new { type = "json_object" },
            messages = new object[]
            {
                new { role = "system", content = "Extract the purchasable products from this web page text. Return {\"products\":[{\"name\":string,\"price\":number,\"currency\":string|null}]} — at most 20 products, price 0 when unknown. No commentary." },
                new { role = "user", content = $"URL: {uri}\n\nPAGE TEXT:\n{text}" }
            }
        }), Encoding.UTF8, "application/json");
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(25);
        using var response = await client.SendAsync(request);
        if (!response.IsSuccessStatusCode) return [];
        var completion = JsonSerializer.Deserialize<ChatCompletionResponse>(await response.Content.ReadAsStringAsync(), JsonOptions());
        var content = completion?.Choices.FirstOrDefault()?.Message.Content;
        if (string.IsNullOrWhiteSpace(content)) return [];
        var node = JsonNode.Parse(ExtractFirstJsonObject(content!) ?? content!);
        if (node?["products"] is not JsonArray array) return [];
        return array
            .OfType<JsonObject>()
            .Select(item => new ScrapedProduct(
                item["name"]?.GetValue<string?>() ?? "",
                ParseScrapedPrice(item["price"]?.ToString()),
                item["currency"]?.GetValue<string?>(),
                null))
            .Where(item => !string.IsNullOrWhiteSpace(item.Name))
            .Take(20)
            .ToList();
    }
    catch
    {
        return [];
    }
}

// ---------------------------------------------------------------------------
// Belge tarama OCR (R18): OpenAI Vision ile metin + form alanı çıkarımı.
// ---------------------------------------------------------------------------

static async Task<(string ExtractedText, string Summary, string FieldsJson, string DocumentType)?> AnalyzeDocumentWithVision(
    StoredFileEntity stored,
    AppUser? seller,
    CompanyEntity? company,
    string language,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory,
    string apiKey)
{
    try
    {
        var bytes = await File.ReadAllBytesAsync(stored.StoragePath);
        var dataUrl = $"data:{stored.ContentType};base64,{Convert.ToBase64String(bytes)}";
        var model = configuration["OpenAI:VisionModel"] ?? configuration["OpenAI:ChatModel"] ?? "gpt-4o-mini";
        var context = JsonSerializer.Serialize(new
        {
            today = AppTime.UserToday(DateTimeOffset.Now).ToString("yyyy-MM-dd"),
            user = new
            {
                name = seller?.Name,
                company = seller?.CompanyName,
                address = seller?.CompanyAddress,
                phone = seller?.CompanyPhone,
                email = seller?.CompanyEmail,
                taxId = seller?.CompanyTaxId,
                iban = seller?.CompanyIban
            },
            customer = company is null ? null : new
            {
                name = company.Name,
                address = company.Address,
                phone = company.Phone,
                email = company.Email,
                contact = company.ContactPerson
            }
        });
        var systemPrompt =
            "You are the document scanner of a field-sales app. Read the scanned form/document image and return ONE JSON object: " +
            "{\"extractedText\": string (full OCR text), " +
            $"\"summary\": string (1-2 sentences in language '{language}'), " +
            "\"documentType\": string (invoice|form|contract|measurement|receipt|other), " +
            "\"fields\": [{\"label\": string, \"value\": string (value already written in the document, else empty), " +
            "\"suggestedValue\": string (for BLANK fields only: fill from the provided user/customer context when it is clearly the right value — company name, address, phone, email, tax id, IBAN, date — else empty)}]}. " +
            "List every labeled slot or blank line of the form as a field.";

        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(new
        {
            model,
            temperature = 0,
            response_format = new { type = "json_object" },
            messages = new object[]
            {
                new { role = "system", content = systemPrompt },
                new
                {
                    role = "user",
                    content = new object[]
                    {
                        new { type = "text", text = $"CONTEXT (for filling blanks):\n{context}" },
                        new { type = "image_url", image_url = new { url = dataUrl } }
                    }
                }
            }
        }), Encoding.UTF8, "application/json");
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(60);
        using var response = await client.SendAsync(request);
        if (!response.IsSuccessStatusCode) return null;
        var completion = JsonSerializer.Deserialize<ChatCompletionResponse>(await response.Content.ReadAsStringAsync(), JsonOptions());
        var content = completion?.Choices.FirstOrDefault()?.Message.Content;
        if (string.IsNullOrWhiteSpace(content)) return null;
        var node = JsonNode.Parse(ExtractFirstJsonObject(content!) ?? content!);
        if (node is not JsonObject root) return null;
        return (
            root["extractedText"]?.GetValue<string?>() ?? "",
            root["summary"]?.GetValue<string?>() ?? "",
            (root["fields"] as JsonArray)?.ToJsonString() ?? "",
            root["documentType"]?.GetValue<string?>() ?? "");
    }
    catch
    {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Geç kalma botu (R16): mesaj taslağı + isteğe bağlı AI cilası.
// ---------------------------------------------------------------------------

static string BuildLateNoticeMessage(AppUser? user, CompanyEntity? company, BusinessTaskEntity task, int delayMinutes, string language)
{
    var name = user?.Name ?? "";
    var target = !string.IsNullOrWhiteSpace(company?.ContactPerson) ? company!.ContactPerson : company?.Name ?? "";
    var greetingSuffix = string.IsNullOrWhiteSpace(target) ? "" : $" {target}";
    var hours = delayMinutes / 60;
    var minutes = delayMinutes % 60;
    return NormalizeLanguage(language) switch
    {
        "de" => $"Guten Tag{greetingSuffix}, leider verspäte ich mich um ca. {(hours > 0 ? $"{hours} Std. {(minutes > 0 ? $"{minutes} Min." : "")}".Trim() : $"{minutes} Minuten")} zu unserem Termin ({task.Title}). Entschuldigen Sie bitte die Unannehmlichkeiten. Mit freundlichen Grüßen, {name}",
        "en" => $"Hello{greetingSuffix}, I'm running about {(hours > 0 ? $"{hours}h {(minutes > 0 ? $"{minutes}m" : "")}".Trim() : $"{minutes} minutes")} late for our appointment ({task.Title}). Apologies for the inconvenience. Best regards, {name}",
        _ => $"Merhaba{greetingSuffix}, randevumuza ({task.Title}) maalesef yaklaşık {(hours > 0 ? $"{hours} saat {(minutes > 0 ? $"{minutes} dakika" : "")}".Trim() : $"{minutes} dakika")} geç kalacağım. Anlayışınız için teşekkür ederim. {name}"
    };
}

static async Task<string?> PolishMessageWithOpenAi(string message, string language, IConfiguration configuration, IHttpClientFactory httpClientFactory, string apiKey)
{
    try
    {
        var model = configuration["OpenAI:ChatModel"] ?? "gpt-4o-mini";
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(new
        {
            model,
            temperature = 0.4,
            messages = new object[]
            {
                new { role = "system", content = $"Rewrite the following SMS to a customer so it sounds natural and polite in language '{language}'. Keep the meaning, the delay amount and roughly the same length. Return ONLY the message text." },
                new { role = "user", content = message }
            }
        }), Encoding.UTF8, "application/json");
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(15);
        using var response = await client.SendAsync(request);
        if (!response.IsSuccessStatusCode) return null;
        var completion = JsonSerializer.Deserialize<ChatCompletionResponse>(await response.Content.ReadAsStringAsync(), JsonOptions());
        return completion?.Choices.FirstOrDefault()?.Message.Content?.Trim();
    }
    catch
    {
        return null;
    }
}

public static class Ids
{
    public static string New(string prefix) => $"{prefix}-{Guid.NewGuid():N}";
}

// Görev vade/durum hesabı — hem top-level endpoint kodu hem arka plan servisleri kullanır.
public static class TaskLogic
{
    public static DateTimeOffset? ParseTaskDueAt(BusinessTaskEntity task)
    {
        if (!DateOnly.TryParse(task.DueDate, out var date) || !TimeOnly.TryParse(task.DueTime, out var time))
        {
            return null;
        }

        // DueDate/DueTime are bare wall-clock strings authored by the user in Türkiye
        // (Europe/Istanbul) local time. Resolve them against that fixed zone and return
        // an absolute instant, NOT the arbitrary server timezone (the API is hosted in
        // Germany), otherwise reminders fire hours off — or, for near-term tasks whose
        // lead-in entries fall before "now", never schedule at all.
        return AppTime.ToInstant(date, time);
    }

    public static string GetEffectiveTaskStatus(BusinessTaskEntity task, DateTimeOffset? now = null)
    {
        if (string.Equals(task.Status, "done", StringComparison.OrdinalIgnoreCase))
        {
            return "done";
        }

        // Approval-pending tasks must keep their workflow status — never let the
        // "overdue" computation overwrite the user's submitted request.
        if (string.Equals(task.Status, "pending_approval", StringComparison.OrdinalIgnoreCase))
        {
            return "pending_approval";
        }

        var dueAt = ParseTaskDueAt(task);
        if (dueAt is not null && dueAt.Value < (now ?? DateTimeOffset.Now))
        {
            return "overdue";
        }

        return task.Status;
    }
}

public interface IOwnedEntity
{
    string Id { get; set; }
    string UserId { get; set; }
}

public static class ClaimsExtensions
{
    public static string UserId(this ClaimsPrincipal principal) =>
        principal.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new UnauthorizedAccessException("Missing user id.");

    public static bool IsAdmin(this ClaimsPrincipal principal) =>
        principal.FindFirst("is_admin")?.Value == "true";

    public static bool IsSystemAdmin(this ClaimsPrincipal principal) =>
        principal.FindFirst("is_system_admin")?.Value == "true";
}

public static class QueryExtensions
{
    public static IQueryable<T> WhereUser<T>(this DbSet<T> set, ClaimsPrincipal principal) where T : class, IOwnedEntity =>
        set.Where(item => item.UserId == principal.UserId());
}

public sealed class ArxTaskDbContext(DbContextOptions<ArxTaskDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<CompanyEntity> Companies => Set<CompanyEntity>();
    public DbSet<WorkModuleEntity> Modules => Set<WorkModuleEntity>();
    public DbSet<BusinessTaskEntity> Tasks => Set<BusinessTaskEntity>();
    public DbSet<NoteEntity> Notes => Set<NoteEntity>();
    public DbSet<DocumentEntity> Documents => Set<DocumentEntity>();
    public DbSet<ProductEntity> Products => Set<ProductEntity>();
    public DbSet<OfferEntity> Offers => Set<OfferEntity>();
    public DbSet<OfferItemEntity> OfferItems => Set<OfferItemEntity>();
    public DbSet<InvoiceEntity> Invoices => Set<InvoiceEntity>();
    public DbSet<InvoiceItemEntity> InvoiceItems => Set<InvoiceItemEntity>();
    public DbSet<ReminderEntity> Reminders => Set<ReminderEntity>();
    public DbSet<PushSubscriptionEntity> PushSubscriptions => Set<PushSubscriptionEntity>();
    public DbSet<MobileDeviceEntity> MobileDevices => Set<MobileDeviceEntity>();
    public DbSet<TaskAlertEntity> TaskAlerts => Set<TaskAlertEntity>();
    public DbSet<TimelineEntryEntity> Timeline => Set<TimelineEntryEntity>();
    public DbSet<RouteEntity> Routes => Set<RouteEntity>();
    public DbSet<RouteStopEntity> RouteStops => Set<RouteStopEntity>();
    public DbSet<StoredFileEntity> StoredFiles => Set<StoredFileEntity>();
    public DbSet<ShoppingItemEntity> ShoppingItems => Set<ShoppingItemEntity>();
    public DbSet<CompanyVisitEntity> CompanyVisits => Set<CompanyVisitEntity>();
    public DbSet<ReportEntity> Reports => Set<ReportEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>().HasIndex(user => user.Email).IsUnique();
        modelBuilder.Entity<CompanyEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<WorkModuleEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<BusinessTaskEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<NoteEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<DocumentEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<ProductEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<OfferEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<OfferItemEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<InvoiceEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<InvoiceItemEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<ReminderEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<PushSubscriptionEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<MobileDeviceEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<TaskAlertEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<TimelineEntryEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<RouteEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<RouteStopEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<StoredFileEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<ShoppingItemEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<CompanyVisitEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<ReportEntity>().HasKey(item => new { item.UserId, item.Id });
        modelBuilder.Entity<OfferEntity>().HasMany(item => item.Items).WithOne().HasForeignKey(item => new { item.UserId, item.OfferId }).HasPrincipalKey(item => new { item.UserId, item.Id }).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<InvoiceEntity>().HasMany(item => item.Items).WithOne().HasForeignKey(item => new { item.UserId, item.InvoiceId }).HasPrincipalKey(item => new { item.UserId, item.Id }).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<RouteEntity>().HasMany(item => item.Stops).WithOne().HasForeignKey(item => new { item.UserId, item.RouteId }).HasPrincipalKey(item => new { item.UserId, item.Id }).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class AppUser
{
    public string Id { get; set; } = "";
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public bool IsAdmin { get; set; }
    public bool IsSystemAdmin { get; set; }
    // Satıcı/işletme profili — teklif ve fatura PDF'lerinde antet olarak kullanılır.
    public string CompanyName { get; set; } = "";
    public string CompanyAddress { get; set; } = "";
    public string CompanyPhone { get; set; } = "";
    public string CompanyEmail { get; set; } = "";
    public string CompanyTaxId { get; set; } = "";
    public string CompanyIban { get; set; } = "";
    public string PaymentTerms { get; set; } = "";
    // 0 = varsayılan hatırlatma merdiveni; >0 = "N dakika önce" tekil hatırlatma.
    public int DefaultReminderLeadMinutes { get; set; }
    // Evden çıkış geofence'i ve otomatik günlük rota için ev konumu.
    public double HomeLatitude { get; set; }
    public double HomeLongitude { get; set; }
    public string HomeAddress { get; set; } = "";
    public bool DailyDigestEnabled { get; set; } = true;
    public bool WeeklyDigestEnabled { get; set; } = true;
}

public sealed class CompanyEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Address { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Email { get; set; } = "";
    public string ContactPerson { get; set; } = "";
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public string Status { get; set; } = "new";
    public string Tags { get; set; } = "";
    // null = aktif. Doldurulduğunda firma "Eski Firmalar" arşiv görünümüne taşınır.
    public string? ArchivedAt { get; set; }
    // Geocoding sonucu: sağlayıcının döndürdüğü standart adres + doğrulama durumu.
    public string FormattedAddress { get; set; } = "";
    public bool AddressVerified { get; set; }
    public string? AddressVerifiedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class WorkModuleEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Type { get; set; } = "custom";
    public bool CreatedByAI { get; set; }
    public bool IsPinnedToSidebar { get; set; } = true;
    public int TaskCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class BusinessTaskEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string? CompanyId { get; set; }
    // AI capture'da kişi adı yakalandığında doldurulur (firma değilse).
    public string? ContactPersonName { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Type { get; set; } = "todo";
    public string ModuleIds { get; set; } = "";
    public string? DueDate { get; set; }
    public string? DueTime { get; set; }
    public string? TimeWindow { get; set; }
    public string? ReminderInterval { get; set; }
    public bool RepeatUntilDone { get; set; }
    public string Status { get; set; } = "open";
    public string Priority { get; set; } = "medium";
    public bool NotificationsEnabled { get; set; } = true;
    public string? NextAlertAt { get; set; }
    public int AlertCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string? CompletedAt { get; set; }
    public string? CompletionRequestedAt { get; set; }
    public string? CompletionRequestedNote { get; set; }
    public string? LastRejectedAt { get; set; }
    public string? LastRejectionReason { get; set; }
    // Yönetici tarafından atanan görevlerde atayanın kullanıcı kimliği.
    public string? AssignedByUserId { get; set; }
    // Çalışan atanan görevi görüp kabul ettiğinde damgalanır (yönetici de görür).
    public string? AcknowledgedAt { get; set; }
    // true → tamamlama isteği fotoğraf kanıtı olmadan kabul edilmez.
    public bool RequirePhotoProof { get; set; }
    public string? CompletionPhotoId { get; set; }
    // Görev ertelendiğinde / geciktiğinde kullanıcıdan alınan neden.
    public string? DelayReason { get; set; }
    // Alışkanlık hedefi: "kitap okumak istiyorum" gibi. IsHabit true iken görev
    // önce "planning" aşamasındadır (2-3 günde bir "ne zaman başlayalım?" dürtmesi),
    // başlama tarihi belirlenince "active" olur (günlük alışkanlık hatırlatması).
    public bool IsHabit { get; set; }
    public string HabitStage { get; set; } = "";        // planning | active | ""
    public string? HabitStartDate { get; set; }
    public int NudgeIntervalDays { get; set; } = 2;
    public string HabitReminderTime { get; set; } = "20:00";
    public string? HabitNudgeJobId { get; set; }
    public string? NextNudgeAt { get; set; }
}

public sealed class NoteEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string? CompanyId { get; set; }
    public string? TaskId { get; set; }
    public string Content { get; set; } = "";
    public string SourceType { get; set; } = "manual";
    public string? SourceTranscript { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class DocumentEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string? CompanyId { get; set; }
    public string FileName { get; set; } = "";
    public string FileType { get; set; } = "";
    public string DocumentType { get; set; } = "";
    public string ExtractedText { get; set; } = "";
    public string Summary { get; set; } = "";
    // Gerçek dosya yüklendiyse StoredFiles kaydının kimliği.
    public string? FileId { get; set; }
    // OCR/AI'nin belgeden çıkardığı alanlar ve doldurulan boşluklar (JSON).
    public string FieldsJson { get; set; } = "";
    public DateTimeOffset UploadedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class ProductEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Category { get; set; } = "";
    public string Description { get; set; } = "";
    public decimal CostPrice { get; set; }
    public decimal SellingPrice { get; set; }
    public decimal MinimumPrice { get; set; }
    public string Currency { get; set; } = "EUR";
    public decimal Margin { get; set; }
    public string UpdatedAt { get; set; } = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
}

public sealed class OfferEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string CompanyId { get; set; } = "";
    public string OfferNumber { get; set; } = "";
    public string OfferDate { get; set; } = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
    public string Title { get; set; } = "";
    public string Status { get; set; } = "draft";
    // "offer" = normal teklif, "package" = paket teklifi (web sidebar > Satış > Paketler).
    public string Kind { get; set; } = "offer";
    public List<OfferItemEntity> Items { get; set; } = [];
    public decimal Subtotal { get; set; }
    public decimal VatRate { get; set; } = 0.19m;
    public decimal VatAmount { get; set; }
    public decimal Total { get; set; }
    public string Currency { get; set; } = "EUR";
    public int ValidityDays { get; set; } = 14;
    public string Notes { get; set; } = "";
    public string? PdfUrl { get; set; }
}

public sealed class OfferItemEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string OfferId { get; set; } = "";
    public string ProductName { get; set; } = "";
    public string Description { get; set; } = "";
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal TotalPrice { get; set; }
    // Linkten teklif oluşturmada üründen çekilen görsel adresi.
    public string ImageUrl { get; set; } = "";
}

public sealed class InvoiceEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string CompanyId { get; set; } = "";
    public string InvoiceNumber { get; set; } = "";
    public string InvoiceDate { get; set; } = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
    public string DueDate { get; set; } = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(14)).ToString("yyyy-MM-dd");
    public string Status { get; set; } = "unpaid";
    public List<InvoiceItemEntity> Items { get; set; } = [];
    public decimal Subtotal { get; set; }
    public decimal VatRate { get; set; } = 0.19m;
    public decimal Total { get; set; }
    public string? PaidAt { get; set; }
}

public sealed class InvoiceItemEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string InvoiceId { get; set; } = "";
    public string ProductName { get; set; } = "";
    public string Description { get; set; } = "";
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal TotalPrice { get; set; }
}

public sealed class ReminderEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string TaskId { get; set; } = "";
    public string StartTime { get; set; } = "";
    public string RepeatInterval { get; set; } = "";
    public bool ActiveUntilDone { get; set; }
    public string Status { get; set; } = "active";
    public bool NotificationsEnabled { get; set; } = true;
}

public sealed class PushSubscriptionEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Endpoint { get; set; } = "";
    public string P256dh { get; set; } = "";
    public string Auth { get; set; } = "";
    public string UserAgent { get; set; } = "";
    public string Platform { get; set; } = "web";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset LastSeenAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? DisabledAt { get; set; }
}

public sealed class MobileDeviceEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string ExpoPushToken { get; set; } = "";
    public string DeviceName { get; set; } = "";
    public string DeviceModel { get; set; } = "";
    public string Platform { get; set; } = "android";
    public string AppVersion { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset LastSeenAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? DisabledAt { get; set; }
}

public sealed class TaskAlertEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string TaskId { get; set; } = "";
    public string? ReminderId { get; set; }
    public DateTimeOffset ScheduledFor { get; set; }
    public string Kind { get; set; } = "";
    public string Status { get; set; } = "pending";
    public string ActionTokenHash { get; set; } = "";
    public string ActionToken { get; set; } = "";
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset? ActedAt { get; set; }
    public string? HangfireJobId { get; set; }
}

public sealed class TimelineEntryEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string CompanyId { get; set; } = "";
    public string Type { get; set; } = "";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTimeOffset Date { get; set; } = DateTimeOffset.UtcNow;
    public string? RelatedId { get; set; }
}

public sealed class RouteEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Date { get; set; } = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");
    public List<RouteStopEntity> Stops { get; set; } = [];
    public string TotalDistance { get; set; } = "";
    public string TotalDuration { get; set; } = "";
    // planned | active | completed — haftalık analizde rota geçmişi için.
    public string Status { get; set; } = "planned";
    // manual = kullanıcı oluşturdu, auto-home-exit = evden çıkış tetiklemesi.
    public string Source { get; set; } = "manual";
    public string? StartedAt { get; set; }
    public string? CompletedAt { get; set; }
}

public sealed class RouteStopEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string RouteId { get; set; } = "";
    public string CompanyId { get; set; } = "";
    public int Order { get; set; }
    public string DistanceFromPrevious { get; set; } = "";
    public string DurationFromPrevious { get; set; } = "";
    public string? VisitedAt { get; set; }
}

// Yüklenen gerçek dosyalar (görev tamamlama fotoğrafları, taranan belgeler).
public sealed class StoredFileEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Size { get; set; }
    public string StoragePath { get; set; } = "";
    // photo | document
    public string Kind { get; set; } = "photo";
    public string? RelatedId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

// Alınacak ürün listesi — rota üzerindeki satıcı bildirimleri bu listeden beslenir.
public sealed class ShoppingItemEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Category { get; set; } = "";
    // Opsiyonel: belirli bir market/dükkan zinciri (BIM, Migros, A101...). Doluysa
    // rota koridorunda yalnızca bu isimli işletmeler eşleştirilir.
    public string Chain { get; set; } = "";
    public string Status { get; set; } = "open";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string? CompletedAt { get; set; }
}

// Firma ziyaret geçmişi — haftalık "hangi rotadan hangi firmalara gidildi" analizi.
public sealed class CompanyVisitEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string CompanyId { get; set; } = "";
    public string? RouteId { get; set; }
    public string? TaskId { get; set; }
    // route | geofence | manual
    public string Source { get; set; } = "manual";
    public string Note { get; set; } = "";
    public DateTimeOffset VisitedAt { get; set; } = DateTimeOffset.UtcNow;
}

// Günlük / haftalık özet raporlarının kalıcı kaydı (payload JSON olarak saklanır).
public sealed class ReportEntity : IOwnedEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    // daily | weekly
    public string Kind { get; set; } = "daily";
    public string Date { get; set; } = "";
    public string Payload { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed record AuthRequest(string Email, string Password, string? Name);
public sealed record TaskCompletionRequest(string? Note, string? PhotoFileId = null);
public sealed record TaskRejectRequest(string? Reason);
public sealed record AdminPromoteResponse(UserDto User);
public sealed record UserDto(string Id, string Email, string Name, bool IsAdmin, bool IsSystemAdmin)
{
    public static UserDto From(AppUser user) => new(user.Id, user.Email, user.Name, user.IsAdmin, user.IsSystemAdmin);
}
public sealed record AuthResponse(string Token, UserDto User)
{
    public static AuthResponse From(AppUser user, string token) => new(token, UserDto.From(user));
}
public sealed record AppSnapshot(
    List<CompanyEntity> Companies,
    List<WorkModuleEntity> Modules,
    List<BusinessTaskEntity> Tasks,
    List<NoteEntity> Notes,
    List<DocumentEntity> Documents,
    List<OfferEntity> Offers,
    List<InvoiceEntity> Invoices,
    List<ProductEntity> Products,
    List<ReminderEntity> Reminders,
    List<TimelineEntryEntity> Timeline,
    List<RouteEntity> Routes);
public sealed record ParsedCommitRequest(
    string? CompanyName,
    List<string> ModuleNames,
    string TaskTitle,
    string TaskType,
    string? DueDate,
    string? DueTime,
    string? TimeWindow,
    string Priority,
    string? ReminderRule,
    string SourceText);
public sealed record AssistantAskRequest(string Question, string? Language = null);
public sealed record AiCaptureAnalyzeRequest(
    string SourceText,
    string SourceType,
    string Language,
    AiCompanyResolutionRequest? CompanyResolution = null,
    AiCompanyDraftRequest? CompanyDraft = null,
    List<AiCompanyDraftRequest>? CompanyDrafts = null);
public sealed record AiCaptureAnalyzeResponse(
    AppSnapshot Snapshot,
    AiCaptureAnalysis Analysis,
    AiCreatedRecords Created,
    AiCompanyResolutionPrompt? CompanyResolution = null,
    bool RequiresCompanyResolution = false,
    AiCompanyAddressPrompt? AddressResolution = null,
    bool RequiresAddressResolution = false,
    List<AiCompanyAddressPrompt>? AddressResolutions = null);
public sealed record AiCreatedRecords(string? CompanyId, List<string> TaskIds, List<string> ModuleIds, List<string> ReminderIds, string? OfferId = null, string? InvoiceId = null);
public sealed record AiCompanyResolutionRequest(string? ExistingCompanyId = null, bool CreateSeparateCompany = false);
public sealed record AiCompanyDraftRequest(string? DetectedName = null, string? Name = null, string? Address = null, string? Phone = null, string? Email = null, string? ContactPerson = null);
public sealed record AiCompanyResolutionPrompt(string DetectedName, List<AiCompanyResolutionCandidate> Candidates, string Message);
public sealed record AiCompanyResolutionCandidate(string Id, string Name, string Address, int TaskCount, string CreatedAt, double? Latitude, double? Longitude);
public sealed record AiCompanyAddressPrompt(string DetectedName, string Message);
public sealed record CompanyDuplicateGroup(string NormalizedName, List<CompanyDuplicateItem> Companies);
public sealed record CompanyDuplicateItem(string Id, string Name, string Email, string Address, string UpdatedAt);
public sealed record PushSubscriptionRequest(string Endpoint, string P256dh, string Auth, string? UserAgent, string? Platform);
public sealed record PushSubscriptionDeleteRequest(string Endpoint);
public sealed record MobileDeviceRequest(string ExpoPushToken, string? DeviceName, string? DeviceModel, string? Platform, string? AppVersion);
public sealed record MobileDeviceDeleteRequest(string ExpoPushToken);
public sealed record NotificationActionRequest(string Token, string Action);

// --- Yeni özellik istek/yanıt tipleri ---------------------------------------

public sealed record UserSettingsRequest(
    string? Name = null,
    string? CompanyName = null,
    string? CompanyAddress = null,
    string? CompanyPhone = null,
    string? CompanyEmail = null,
    string? CompanyTaxId = null,
    string? CompanyIban = null,
    string? PaymentTerms = null,
    int? DefaultReminderLeadMinutes = null,
    double? HomeLatitude = null,
    double? HomeLongitude = null,
    string? HomeAddress = null,
    bool? DailyDigestEnabled = null,
    bool? WeeklyDigestEnabled = null);

public sealed record UserSettingsDto(
    string Id,
    string Email,
    string Name,
    string CompanyName,
    string CompanyAddress,
    string CompanyPhone,
    string CompanyEmail,
    string CompanyTaxId,
    string CompanyIban,
    string PaymentTerms,
    int DefaultReminderLeadMinutes,
    double HomeLatitude,
    double HomeLongitude,
    string HomeAddress,
    bool DailyDigestEnabled,
    bool WeeklyDigestEnabled)
{
    public static UserSettingsDto From(AppUser user) => new(
        user.Id,
        user.Email,
        user.Name,
        user.CompanyName,
        user.CompanyAddress,
        user.CompanyPhone,
        user.CompanyEmail,
        user.CompanyTaxId,
        user.CompanyIban,
        user.PaymentTerms,
        user.DefaultReminderLeadMinutes,
        user.HomeLatitude,
        user.HomeLongitude,
        user.HomeAddress,
        user.DailyDigestEnabled,
        user.WeeklyDigestEnabled);
}

public sealed record AssignTaskRequest(
    string TargetUserId,
    string Title,
    string? Description = null,
    string? CompanyId = null,
    string? DueDate = null,
    string? DueTime = null,
    string? Priority = null,
    string? Type = null,
    string? ModuleIds = null,
    bool? RequirePhotoProof = null);

public sealed record TaskSnoozeRequest(int? Hours = null, string? UntilDate = null, string? UntilTime = null, string? Reason = null);
public sealed record HabitStartRequest(string StartDate, string? ReminderTime = null, int? IntervalDays = null);
public sealed record HabitSnoozeRequest(int? Days = null);
public sealed record OfferFromUrlRequest(string Url, string? CompanyId = null, string? Title = null);
public sealed record RouteErrandRequest(List<List<double>> Coords, int? BufferMeters = null);
public sealed record OverpassPoi(string Name, double Lat, double Lng, string ShopTag);
public sealed record ErrandMatch(string ItemId, string ItemName, string ShopName, string Category, string Chain, double Lat, double Lng, double DistanceToRouteMeters);
public sealed record LateNoticeDraftRequest(string TaskId, int DelayMinutes, string? Language = null);
public sealed record LateNoticeLogRequest(string TaskId, string? Message, string? Channel);
public sealed record ScrapedProduct(string Name, decimal Price, string? Currency, string? ImageUrl);

public sealed record AiCaptureAnalysis
{
    public string DetectedLanguage { get; init; } = "en";
    public AiCompany Company { get; init; } = new();
    public List<AiModule> Modules { get; init; } = [];
    public List<AiTask> Tasks { get; init; } = [];
    public List<string> Notes { get; init; } = [];
    public AiOfferData OfferData { get; init; } = new(false, [], [], "EUR");
    public AiDocumentData DocumentData { get; init; } = new(false, null);
}

public sealed record AiCompany(string? Name = null, double Confidence = 0, bool ShouldCreateIfMissing = false);
public sealed record AiModule(string Name = "To Do", string Type = "todo", double Confidence = 0, bool ShouldCreateIfMissing = false);
public sealed record AiTask(
    string Title = "",
    string Description = "",
    string Type = "todo",
    string? DueDate = null,
    string? DueTime = null,
    string? TimeWindow = null,
    string Priority = "medium",
    string? ReminderRule = null,
    string? CompanyName = null,
    string? ContactPersonName = null,
    double PersonConfidence = 0,
    bool IsHabit = false);
public sealed record AiOfferData(bool Detected, List<string> Products, List<decimal> Prices, string Currency);
public sealed record AiDocumentData(bool Detected, string? Type);

public sealed record ChatCompletionResponse(List<ChatChoice> Choices);
public sealed record ChatChoice(ChatMessage Message);
public sealed record ChatMessage(string Content);

public sealed record PushPayload(
    string Title,
    string Body,
    string Url,
    string? TaskId = null,
    string? ActionToken = null,
    string? CategoryId = null,
    object[]? Actions = null,
    Dictionary<string, object?>? ExtraData = null);

public static class PushDispatcher
{
    public static async Task DispatchPushNow(
        ArxTaskDbContext db,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        IEnumerable<string> userIds,
        PushPayload payload,
        CancellationToken cancellationToken = default)
    {
        var userList = userIds.Distinct().ToList();
        if (userList.Count == 0) return;

        var subscriptions = await db.PushSubscriptions
            .Where(item => userList.Contains(item.UserId) && item.DisabledAt == null)
            .ToListAsync(cancellationToken);
        var mobileDevices = await db.MobileDevices
            .Where(item => userList.Contains(item.UserId) && item.DisabledAt == null)
            .ToListAsync(cancellationToken);
        if (subscriptions.Count == 0 && mobileDevices.Count == 0) return;

        var dataBag = new Dictionary<string, object?>
        {
            ["url"] = payload.Url,
            ["taskId"] = payload.TaskId,
            ["token"] = payload.ActionToken
        };
        if (payload.ExtraData is not null)
        {
            foreach (var (key, value) in payload.ExtraData) dataBag[key] = value;
        }

        var webPushJson = JsonSerializer.Serialize(new
        {
            title = payload.Title,
            body = payload.Body,
            url = payload.Url,
            taskId = payload.TaskId,
            token = payload.ActionToken,
            actions = payload.Actions ?? Array.Empty<object>(),
            data = dataBag
        });

        var publicKey = configuration["WebPush:PublicKey"];
        var privateKey = configuration["WebPush:PrivateKey"];
        var subject = configuration["WebPush:Subject"] ?? "mailto:notifications@arxtask.local";
        WebPushClient? client = null;
        if (!string.IsNullOrWhiteSpace(publicKey) && !string.IsNullOrWhiteSpace(privateKey))
        {
            client = new WebPushClient();
            client.SetVapidDetails(subject, publicKey!, privateKey!);
        }

        foreach (var subscription in subscriptions)
        {
            if (client is null) break;
            try
            {
                await client.SendNotificationAsync(
                    new PushSubscription(subscription.Endpoint, subscription.P256dh, subscription.Auth),
                    webPushJson,
                    cancellationToken: cancellationToken);
            }
            catch
            {
                subscription.DisabledAt ??= DateTimeOffset.UtcNow;
            }
        }

        if (mobileDevices.Count > 0)
        {
            var expoClient = httpClientFactory.CreateClient();
            if (!string.IsNullOrWhiteSpace(configuration["Expo:AccessToken"]))
            {
                expoClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", configuration["Expo:AccessToken"]);
            }
            var expoPayload = mobileDevices.Select(device => new
            {
                to = device.ExpoPushToken,
                title = payload.Title,
                body = payload.Body,
                sound = "default",
                priority = "high",
                categoryId = payload.CategoryId ?? "task-reminder",
                channelId = "task-reminders",
                data = dataBag
            }).ToList();
            await SendExpoPushBatch(expoClient, expoPayload, mobileDevices, cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    // Sends a batch of Expo push messages (messages[i] MUST target devices[i]) and processes
    // the returned ticket array: tokens Expo reports as DeviceNotRegistered are disabled so
    // they are not retried forever, and delivery outcome becomes visible instead of a silent
    // fire-and-forget. Returns true if at least one message was accepted. Never throws.
    public static async Task<bool> SendExpoPushBatch(
        HttpClient expoClient,
        object messages,
        IReadOnlyList<MobileDeviceEntity> devices,
        CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://exp.host/--/api/v2/push/send")
            {
                Content = JsonContent.Create(messages)
            };
            using var response = await expoClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return false;
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("data", out var tickets) || tickets.ValueKind != JsonValueKind.Array)
            {
                // 2xx but no ticket array — treat as accepted by the transport.
                return true;
            }

            var anyOk = false;
            var index = 0;
            foreach (var ticket in tickets.EnumerateArray())
            {
                var status = ticket.TryGetProperty("status", out var s) ? s.GetString() : null;
                if (string.Equals(status, "ok", StringComparison.OrdinalIgnoreCase))
                {
                    anyOk = true;
                }
                else if (string.Equals(status, "error", StringComparison.OrdinalIgnoreCase) && index < devices.Count)
                {
                    var errorCode = ticket.TryGetProperty("details", out var details) && details.TryGetProperty("error", out var err)
                        ? err.GetString()
                        : null;
                    // Uninstalled app / invalidated token — stop pushing to it.
                    if (string.Equals(errorCode, "DeviceNotRegistered", StringComparison.OrdinalIgnoreCase))
                    {
                        devices[index].DisabledAt ??= DateTimeOffset.UtcNow;
                    }
                }
                index++;
            }
            return anyOk;
        }
        catch
        {
            // Push failures must not fail the calling handler.
            return false;
        }
    }
}

// Centralised timezone handling. The product's users author reminder times in
// Türkiye (Europe/Istanbul) local time, but the API is hosted in Germany, so the
// host's local timezone must never be used to interpret those wall-clock strings.
internal static class AppTime
{
    internal static readonly TimeZoneInfo UserZone = ResolveUserZone();

    static TimeZoneInfo ResolveUserZone()
    {
        // "Europe/Istanbul" is the IANA id (Linux/macOS hosts); "Turkey Standard Time"
        // is the Windows id. Try both so the code is portable across the dev box and server.
        foreach (var id in new[] { "Europe/Istanbul", "Turkey Standard Time" })
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
            catch (TimeZoneNotFoundException) { }
            catch (InvalidTimeZoneException) { }
        }
        // Türkiye has observed a fixed UTC+3 with no DST since 2016 — safe fallback.
        return TimeZoneInfo.CreateCustomTimeZone("ArxTaskTR", TimeSpan.FromHours(3), "Turkiye (UTC+3)", "Turkiye (UTC+3)");
    }

    // Interpret a bare wall-clock date+time as Istanbul local time and return the absolute instant.
    internal static DateTimeOffset ToInstant(DateOnly date, TimeOnly time)
    {
        var naive = DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Unspecified);
        var offset = UserZone.GetUtcOffset(naive);
        return new DateTimeOffset(naive, offset);
    }

    // The wall-clock DateTime an absolute instant maps to in the user's timezone.
    internal static DateTime UserLocal(DateTimeOffset instant) => TimeZoneInfo.ConvertTime(instant, UserZone).DateTime;

    // The calendar date an absolute instant falls on in the user's timezone.
    internal static DateOnly UserToday(DateTimeOffset instant) => DateOnly.FromDateTime(UserLocal(instant));
}

// Hangfire job target. Each scheduled task reminder fires SendTaskAlertAsync
// at its due time; the job re-reads the alert row, checks it is still pending,
// then dispatches via the shared PushDispatcher helper. Failed jobs are
// retried automatically by Hangfire with exponential backoff.
public interface INotificationDispatcher
{
    Task SendTaskAlertAsync(string userId, string alertId);
    // Alışkanlık "planning" aşamasındayken 2-3 günde bir "ne zaman başlayalım?" dürtmesi.
    Task SendHabitNudgeAsync(string userId, string taskId);
    // Alışkanlık "active" olduğunda günlük hatırlatma.
    Task SendHabitReminderAsync(string userId, string taskId);
}

// Alışkanlık Hangfire işlerini planlayan/temizleyen yardımcı. Hem üst seviye endpoint
// kodundan hem de NotificationDispatcher'dan erişilebilsin diye ayrı bir static sınıf.
public static class HabitScheduler
{
    public static string ReminderJobId(string userId, string taskId) => $"habit-daily-{userId}-{taskId}";

    // Bir sonraki dürtmeyi planlar; önceki dürtme işini iptal edip yenisini kurar.
    public static void ScheduleNudge(BusinessTaskEntity habit, TimeSpan delay)
    {
        if (!string.IsNullOrWhiteSpace(habit.HabitNudgeJobId))
        {
            try { BackgroundJob.Delete(habit.HabitNudgeJobId); } catch { /* best effort */ }
        }
        if (delay < TimeSpan.Zero) delay = TimeSpan.Zero;
        var userId = habit.UserId;
        var taskId = habit.Id;
        habit.HabitNudgeJobId = BackgroundJob.Schedule<INotificationDispatcher>(
            svc => svc.SendHabitNudgeAsync(userId, taskId), delay);
        habit.NextNudgeAt = DateTimeOffset.Now.Add(delay).ToString("O");
    }

    // Alışkanlık "active" olunca günlük hatırlatmayı recurring job olarak kurar.
    public static void ScheduleDailyReminder(BusinessTaskEntity habit)
    {
        var time = TimeOnly.TryParse(habit.HabitReminderTime, out var t) ? t : new TimeOnly(20, 0);
        var cron = $"{time.Minute} {time.Hour} * * *";
        var userId = habit.UserId;
        var taskId = habit.Id;
        RecurringJob.AddOrUpdate<INotificationDispatcher>(
            ReminderJobId(userId, taskId),
            svc => svc.SendHabitReminderAsync(userId, taskId),
            cron,
            new RecurringJobOptions { TimeZone = AppTime.UserZone });
    }

    public static void RemoveJobs(BusinessTaskEntity habit)
    {
        if (!string.IsNullOrWhiteSpace(habit.HabitNudgeJobId))
        {
            try { BackgroundJob.Delete(habit.HabitNudgeJobId); } catch { }
            habit.HabitNudgeJobId = null;
        }
        try { RecurringJob.RemoveIfExists(ReminderJobId(habit.UserId, habit.Id)); } catch { }
    }
}

public sealed class NotificationDispatcher(
    ArxTaskDbContext db,
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration) : INotificationDispatcher
{
    public async Task SendTaskAlertAsync(string userId, string alertId)
    {
        var alert = await db.TaskAlerts.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == alertId);
        if (alert is null || alert.Status != "pending") return;

        var task = await db.Tasks.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == alert.TaskId);
        if (task is null || task.Status == "done")
        {
            alert.Status = "cancelled";
            await db.SaveChangesAsync();
            return;
        }

        // Gecikme uyarıları yalnızca görev gerçekten hâlâ gecikmişse gönderilir —
        // vade değiştiyse veya görev onaya girdiyse sessizce iptal edilir.
        var isOverdueAlert = alert.Kind.StartsWith("overdue", StringComparison.OrdinalIgnoreCase);
        if (isOverdueAlert && TaskLogic.GetEffectiveTaskStatus(task) != "overdue")
        {
            alert.Status = "cancelled";
            await db.SaveChangesAsync();
            return;
        }

        var company = string.IsNullOrWhiteSpace(task.CompanyId)
            ? null
            : await db.Companies.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == task.CompanyId);

        var title = company is null ? task.Title : $"{company.Name} · {task.Title}";
        string body;
        if (isOverdueAlert)
        {
            var dueAt = TaskLogic.ParseTaskDueAt(task);
            var delay = dueAt is null ? TimeSpan.Zero : DateTimeOffset.Now - dueAt.Value;
            var delayText = delay.TotalHours >= 24
                ? $"{(int)delay.TotalDays} gün {(int)(delay.TotalHours % 24)} saat"
                : delay.TotalHours >= 1
                    ? $"{(int)delay.TotalHours} saat"
                    : $"{Math.Max(1, (int)delay.TotalMinutes)} dakika";
            title = $"⚠️ Gecikme: {title}";
            body = $"Görev {delayText} gecikti. Tamamlayın veya erteleyip nedenini belirtin.";
        }
        else
        {
            body = alert.Kind == "due"
                ? $"Görev saati geldi: {task.DueTime ?? task.DueDate ?? task.Title}"
                : $"Göreve {alert.Kind} kaldı. {task.DueTime ?? task.DueDate ?? string.Empty}".Trim();
        }

        var payload = new PushPayload(
            Title: title,
            Body: body,
            Url: $"/today?task={task.Id}",
            TaskId: task.Id,
            ActionToken: alert.ActionToken,
            CategoryId: isOverdueAlert ? "task-overdue" : "task-reminder",
            Actions: new object[]
            {
                new { action = "complete", title = "Tamamlandi" },
                new { action = "snooze-1h", title = "1 Saat Ertele" }
            });

        await PushDispatcher.DispatchPushNow(db, httpClientFactory, configuration, new[] { userId }, payload);

        alert.Status = "sent";
        alert.SentAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
    }

    // "Ne zaman başlamak istiyorsun?" dürtmesi — planning aşamasındaki alışkanlıklar için.
    // Aksiyonlar: "Tarih belirle" (uygulamayı açar) ve "Sonra hatırlat" (birkaç gün ertele).
    public async Task SendHabitNudgeAsync(string userId, string taskId)
    {
        var habit = await db.Tasks.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == taskId);
        // Alışkanlık silinmiş, tamamlanmış veya artık planning değilse dürtmeyi durdur (yeniden planlama).
        if (habit is null || !habit.IsHabit || habit.HabitStage != "planning" || habit.Status == "done")
        {
            return;
        }

        var rawToken = Guid.NewGuid().ToString("N");
        var tokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));
        var alert = new TaskAlertEntity
        {
            Id = Ids.New("task-alert"),
            UserId = userId,
            TaskId = taskId,
            ScheduledFor = DateTimeOffset.Now,
            Kind = "habit-nudge",
            Status = "sent",
            ActionTokenHash = tokenHash,
            ActionToken = rawToken,
            SentAt = DateTimeOffset.UtcNow
        };
        db.TaskAlerts.Add(alert);

        var payload = new PushPayload(
            Title: "Hedefine başlayalım mı? 🎯",
            Body: $"«{habit.Title}» — ne zaman başlamak istiyorsun?",
            Url: $"/today?habit={habit.Id}",
            TaskId: habit.Id,
            ActionToken: rawToken,
            CategoryId: "habit-nudge",
            Actions: new object[]
            {
                new { action = "habit-set-date", title = "Tarih belirle" },
                new { action = "habit-later", title = "Sonra hatırlat" }
            });
        await PushDispatcher.DispatchPushNow(db, httpClientFactory, configuration, new[] { userId }, payload);

        // Bir sonraki dürtmeyi planla (kullanıcı aksiyon almazsa da döngü sürsün).
        HabitScheduler.ScheduleNudge(habit, TimeSpan.FromDays(Math.Max(1, habit.NudgeIntervalDays)));
        await db.SaveChangesAsync();
    }

    // Alışkanlık "active" iken günlük hatırlatma.
    public async Task SendHabitReminderAsync(string userId, string taskId)
    {
        var habit = await db.Tasks.FirstOrDefaultAsync(item => item.UserId == userId && item.Id == taskId);
        if (habit is null || !habit.IsHabit || habit.HabitStage != "active" || habit.Status == "done")
        {
            // Alışkanlık artık aktif değilse recurring işi kaldır.
            if (habit is not null) { try { RecurringJob.RemoveIfExists(HabitScheduler.ReminderJobId(userId, taskId)); } catch { } }
            return;
        }

        var payload = new PushPayload(
            Title: $"Alışkanlık: {habit.Title} 📌",
            Body: "Bugün için zamanı geldi — küçük bir adım da yeterli.",
            Url: $"/today?habit={habit.Id}",
            TaskId: habit.Id,
            CategoryId: "habit-reminder");
        await PushDispatcher.DispatchPushNow(db, httpClientFactory, configuration, new[] { userId }, payload);
    }
}

// Günlük / haftalık özet işleri (R8, R14): yalnızca geciken ve tekrarlayan işleri
// raporlar, sonucu Reports tablosuna yazar ve push bildirimi gönderir.
public interface IDigestService
{
    Task SendDailyDigestsAsync();
    Task SendWeeklyDigestsAsync();
}

public sealed class DigestService(
    ArxTaskDbContext db,
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration) : IDigestService
{
    public Task SendDailyDigestsAsync() => SendDigestsAsync("daily");
    public Task SendWeeklyDigestsAsync() => SendDigestsAsync("weekly");

    private async Task SendDigestsAsync(string kind)
    {
        var now = DateTimeOffset.Now;
        var today = AppTime.UserToday(now);
        var todayText = today.ToString("yyyy-MM-dd");
        var users = await db.Users.ToListAsync();
        foreach (var user in users)
        {
            if (kind == "daily" && !user.DailyDigestEnabled) continue;
            if (kind == "weekly" && !user.WeeklyDigestEnabled) continue;

            var tasks = await db.Tasks.Where(item => item.UserId == user.Id && item.Status != "done").ToListAsync();
            var overdueEntries = tasks
                .Select(item => new { Task = item, DueAt = TaskLogic.ParseTaskDueAt(item) })
                .Where(entry => TaskLogic.GetEffectiveTaskStatus(entry.Task, now) == "overdue")
                .Select(entry => new
                {
                    id = entry.Task.Id,
                    title = entry.Task.Title,
                    companyId = entry.Task.CompanyId,
                    dueDate = entry.Task.DueDate,
                    dueTime = entry.Task.DueTime,
                    delayHours = entry.DueAt is null ? 0 : Math.Max(0, (int)(now - entry.DueAt.Value).TotalHours),
                    delayReason = entry.Task.DelayReason ?? "",
                    recurring = entry.Task.RepeatUntilDone
                })
                .OrderByDescending(entry => entry.delayHours)
                .ToList();
            var recurringEntries = tasks
                .Where(item => item.RepeatUntilDone && TaskLogic.GetEffectiveTaskStatus(item, now) != "overdue")
                .Select(item => new { id = item.Id, title = item.Title, dueDate = item.DueDate })
                .ToList();

            // R14: rapora yalnızca geciken veya tekrarlayan işler girer; ikisi de yoksa rapor yok.
            if (overdueEntries.Count == 0 && recurringEntries.Count == 0) continue;

            var weeklyVisits = 0;
            if (kind == "weekly")
            {
                var weekStart = today.AddDays(-6);
                weeklyVisits = (await db.CompanyVisits.Where(item => item.UserId == user.Id).ToListAsync())
                    .Count(item => AppTime.UserToday(item.VisitedAt) >= weekStart);
            }

            var payload = JsonSerializer.Serialize(new
            {
                kind,
                date = todayText,
                overdue = overdueEntries,
                recurring = recurringEntries,
                weeklyVisits
            });
            var existing = await db.Reports.FirstOrDefaultAsync(item => item.UserId == user.Id && item.Kind == kind && item.Date == todayText);
            if (existing is null)
            {
                db.Reports.Add(new ReportEntity
                {
                    Id = Ids.New("report"),
                    UserId = user.Id,
                    Kind = kind,
                    Date = todayText,
                    Payload = payload,
                    CreatedAt = DateTimeOffset.UtcNow
                });
            }
            else
            {
                existing.Payload = payload;
                existing.CreatedAt = DateTimeOffset.UtcNow;
            }
            await db.SaveChangesAsync();

            var title = kind == "daily" ? "Günlük özet" : "Haftalık özet";
            var body = overdueEntries.Count > 0
                ? $"{overdueEntries.Count} geciken, {recurringEntries.Count} tekrarlayan iş var."
                : $"{recurringEntries.Count} tekrarlayan iş takipte.";
            await PushDispatcher.DispatchPushNow(db, httpClientFactory, configuration, new[] { user.Id }, new PushPayload(
                Title: title,
                Body: body,
                Url: kind == "daily" ? "/overdue" : "/weekly-analysis",
                CategoryId: "digest"));
        }
    }
}

// Authorize access to the /hangfire dashboard by validating the JWT carried
// in the "hangfire-token" HttpOnly cookie. Cookie is set by
// POST /admin/hangfire-session for an already-authenticated admin.
public sealed class HangfireAdminAuthFilter(string issuer, string audience, string secret) : IDashboardAuthorizationFilter
{
    public bool Authorize(DashboardContext context)
    {
        var httpContext = context.GetHttpContext();
        var token = httpContext.Request.Cookies["hangfire-token"];
        if (string.IsNullOrWhiteSpace(token)) return false;
        try
        {
            var handler = new JwtSecurityTokenHandler();
            var validation = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                ValidIssuer = issuer,
                ValidAudience = audience,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret))
            };
            var principal = handler.ValidateToken(token, validation, out _);
            return principal.FindFirst("is_admin")?.Value == "true";
        }
        catch
        {
            return false;
        }
    }
}

[Obsolete("Replaced by NotificationDispatcher + Hangfire delayed jobs. Kept temporarily for reference; not registered.")]
public sealed class TaskAlertDispatcher(IServiceScopeFactory scopeFactory, IConfiguration configuration, IHttpClientFactory httpClientFactory) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await DispatchDueAlerts(stoppingToken);
            }
            catch
            {
            }

            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }

    private async Task DispatchDueAlerts(CancellationToken cancellationToken)
    {
        var publicKey = configuration["WebPush:PublicKey"];
        var privateKey = configuration["WebPush:PrivateKey"];
        var subject = configuration["WebPush:Subject"] ?? "mailto:notifications@arxtask.local";
        var hasWebPush = !string.IsNullOrWhiteSpace(publicKey) && !string.IsNullOrWhiteSpace(privateKey);
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ArxTaskDbContext>();
        var now = DateTimeOffset.Now;
        var dueAlerts = await db.TaskAlerts
            .Where(item => item.Status == "pending" && item.ScheduledFor <= now)
            .OrderBy(item => item.ScheduledFor)
            .Take(30)
            .ToListAsync(cancellationToken);

        if (dueAlerts.Count == 0)
        {
            return;
        }

        WebPushClient? client = null;
        if (hasWebPush)
        {
            client = new WebPushClient();
            client.SetVapidDetails(subject, publicKey!, privateKey!);
        }
        var expoClient = httpClientFactory.CreateClient();
        if (!string.IsNullOrWhiteSpace(configuration["Expo:AccessToken"]))
        {
            expoClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", configuration["Expo:AccessToken"]);
        }

        foreach (var alert in dueAlerts)
        {
            var task = await db.Tasks.FirstOrDefaultAsync(item => item.UserId == alert.UserId && item.Id == alert.TaskId, cancellationToken);
            if (task is null || task.Status == "done")
            {
                alert.Status = "cancelled";
                continue;
            }

            var subscriptions = await db.PushSubscriptions
                .Where(item => item.UserId == alert.UserId && item.DisabledAt == null)
                .ToListAsync(cancellationToken);
            var mobileDevices = await db.MobileDevices
                .Where(item => item.UserId == alert.UserId && item.DisabledAt == null)
                .ToListAsync(cancellationToken);

            if (subscriptions.Count == 0 && mobileDevices.Count == 0)
            {
                continue;
            }

            var company = task.CompanyId is null
                ? null
                : await db.Companies.FirstOrDefaultAsync(item => item.UserId == alert.UserId && item.Id == task.CompanyId, cancellationToken);

            var payload = JsonSerializer.Serialize(new
            {
                title = company is null ? task.Title : $"{company.Name} · {task.Title}",
                body = alert.Kind == "due"
                    ? $"Görev saati geldi: {task.DueTime ?? task.DueDate ?? task.Title}"
                    : $"Göreve {alert.Kind} kaldı. {task.DueTime ?? task.DueDate ?? ""}".Trim(),
                url = $"/today?task={task.Id}",
                taskId = task.Id,
                token = alert.ActionToken,
                actions = new[]
                {
                    new { action = "complete", title = "Tamamlandi" },
                    new { action = "snooze-1h", title = "1 Saat Ertele" }
                }
            });

            var sentToAny = false;
            foreach (var subscription in subscriptions)
            {
                if (client is null)
                {
                    break;
                }
                try
                {
                    await client.SendNotificationAsync(
                        new PushSubscription(subscription.Endpoint, subscription.P256dh, subscription.Auth),
                        payload,
                        cancellationToken: cancellationToken);
                    sentToAny = true;
                }
                catch
                {
                    subscription.DisabledAt ??= DateTimeOffset.UtcNow;
                }
            }

            if (mobileDevices.Count > 0)
            {
                var expoPayload = mobileDevices.Select(device => new
                {
                    to = device.ExpoPushToken,
                    title = company is null ? task.Title : $"{company.Name} · {task.Title}",
                    body = alert.Kind == "due"
                        ? $"Görev saati geldi: {task.DueTime ?? task.DueDate ?? task.Title}"
                        : $"Göreve {alert.Kind} kaldı. {task.DueTime ?? task.DueDate ?? ""}".Trim(),
                    sound = "default",
                    priority = "high",
                    categoryId = "task-reminder",
                    channelId = "task-reminders",
                    data = new
                    {
                        taskId = task.Id,
                        url = "/today",
                        token = alert.ActionToken
                    }
                }).ToList();

                if (await PushDispatcher.SendExpoPushBatch(expoClient, expoPayload, mobileDevices, cancellationToken))
                {
                    sentToAny = true;
                }
            }

            if (sentToAny)
            {
                alert.Status = "sent";
                alert.SentAt = DateTimeOffset.UtcNow;
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
