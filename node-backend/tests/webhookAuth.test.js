// Sets TELEGRAM_WEBHOOK_SECRET before app.js (and therefore config.js) is
// ever imported — Jest gives each test file its own module registry, so
// this doesn't affect any other test file's (unconfigured) environment.
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret-value';

const request = (await import('supertest')).default;
const { default: app, ready } = await import('../src/app.js');

beforeAll(async () => {
  await ready;
});

describe('POST /webhook/telegram — secret token verification', () => {
  it('rejects a request with no secret header when a secret is configured', async () => {
    const res = await request(app)
      .post('/webhook/telegram')
      .send({});
    expect(res.status).toBe(401);
  });

  it('rejects a request with the wrong secret header', async () => {
    const res = await request(app)
      .post('/webhook/telegram')
      .set('x-telegram-bot-api-secret-token', 'not-the-real-secret')
      .send({});
    expect(res.status).toBe(401);
  });

  it('accepts a request with the correct secret header', async () => {
    const res = await request(app)
      .post('/webhook/telegram')
      .set('x-telegram-bot-api-secret-token', 'test-webhook-secret-value')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
