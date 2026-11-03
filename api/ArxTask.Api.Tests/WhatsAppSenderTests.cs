using System.Net;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;

namespace ArxTask.Api.Tests;

public class WhatsAppSenderTests
{
    static readonly WhatsAppDigestContent Content = new("Mehmet", "10:00 Montaj", "Günaydın Mehmet, bugün yapılacakların: 10:00 Montaj", 1);
    const string Token = "SECRET-TOKEN-123";

    static IConfiguration Config(bool configured) => new ConfigurationBuilder()
        .AddInMemoryCollection(configured
            ? new Dictionary<string, string?>
            {
                ["WhatsApp:AccessToken"] = Token,
                ["WhatsApp:PhoneNumberId"] = "1234567890",
                ["WhatsApp:TemplateName"] = "planix_sabah_ozeti"
            }
            : new Dictionary<string, string?>())
        .Build();

    [Fact]
    public void Payload_matches_graph_template_shape()
    {
        var payload = WhatsAppCloudSender.BuildTemplatePayload("905321234567", "planix_sabah_ozeti", "tr", "Mehmet", "10:00 Montaj");
        var expected = """
            {"messaging_product":"whatsapp","to":"905321234567","type":"template",
             "template":{"name":"planix_sabah_ozeti","language":{"code":"tr"},
              "components":[{"type":"body","parameters":[{"type":"text","text":"Mehmet"},{"type":"text","text":"10:00 Montaj"}]}]}}
            """;
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(expected), JsonNode.Parse(payload)), payload);
    }

    [Fact]
    public async Task Unconfigured_sender_returns_dry_run()
    {
        var handler = new RecordingHandler(HttpStatusCode.OK, "{}");
        var sender = new WhatsAppCloudSender(new FakeHttpClientFactory(handler), Config(false));

        Assert.False(sender.IsConfigured);
        var result = await sender.SendDigestAsync("+905321234567", Content);

        Assert.Equal("dry-run", result.Status);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Graph_error_returns_failed_without_token_in_error()
    {
        var handler = new RecordingHandler(HttpStatusCode.BadRequest, """{"error":{"message":"Invalid parameter"}}""");
        var sender = new WhatsAppCloudSender(new FakeHttpClientFactory(handler), Config(true));

        var result = await sender.SendDigestAsync("+905321234567", Content);

        Assert.Equal("failed", result.Status);
        Assert.Contains("Invalid parameter", result.Error);
        Assert.DoesNotContain(Token, result.Error);
    }

    [Fact]
    public async Task Network_error_returns_failed()
    {
        var sender = new WhatsAppCloudSender(new FakeHttpClientFactory(new ThrowingHandler()), Config(true));
        var result = await sender.SendDigestAsync("+905321234567", Content);
        Assert.Equal("failed", result.Status);
        Assert.NotNull(result.Error);
    }

    [Fact]
    public async Task Graph_success_returns_message_id()
    {
        var handler = new RecordingHandler(HttpStatusCode.OK, """{"messages":[{"id":"wamid.X"}]}""");
        var sender = new WhatsAppCloudSender(new FakeHttpClientFactory(handler), Config(true));

        var result = await sender.SendDigestAsync("+905321234567", Content);

        Assert.Equal("sent", result.Status);
        Assert.Equal("wamid.X", result.ProviderMessageId);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://graph.facebook.com/v23.0/1234567890/messages", request.Uri);
        Assert.Equal($"Bearer {Token}", request.Authorization);
        Assert.Contains("\"to\":\"905321234567\"", request.Body);
    }
}

sealed class FakeHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
}

sealed class RecordingHandler(HttpStatusCode status, string body) : HttpMessageHandler
{
    public List<(string Uri, string? Authorization, string Body)> Requests { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var content = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        Requests.Add((request.RequestUri!.ToString(), request.Headers.Authorization?.ToString(), content));
        return new HttpResponseMessage(status) { Content = new StringContent(body) };
    }
}

sealed class ThrowingHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
        throw new HttpRequestException("connection refused");
}
