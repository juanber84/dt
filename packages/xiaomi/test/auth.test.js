import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import nock from 'nock';
import { XiaomiAuth, LoginStatus } from '../src/auth.js';

const ACCOUNT = 'https://account.xiaomi.com';
const PREFIX = '&&&START&&&';
const CTX = 'CTX123';

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());
afterEach(() => nock.cleanAll());

function mockServiceLogin() {
  nock(ACCOUNT)
    .get('/pass/serviceLogin')
    .query({ sid: 'xiaomiio', _json: 'true' })
    .reply(200, `${PREFIX}{"_sign":"SIGN"}`);
}

function mockTwoFactorStart() {
  nock(ACCOUNT)
    .get('/identity/authStart')
    .query(true)
    .reply(200, 'ok')
    .get('/identity/list')
    .query(true)
    .reply(200, `${PREFIX}{"code":0}`, { 'Set-Cookie': 'ick=ICK; Path=/' })
    .post('/identity/auth/sendEmailTicket', /ick=ICK/)
    .query(true)
    .reply(200, `${PREFIX}{"code":0}`);
}

function mockTwoFactorFinish() {
  nock(ACCOUNT)
    .post('/identity/auth/verifyEmail', /ticket=123456/)
    .query(true)
    .reply(
      200,
      `${PREFIX}{"code":0,"location":"${ACCOUNT}/identity/result/check?sid=xiaomiio&context=${CTX}"}`,
    )
    .get('/identity/result/check')
    .query(true)
    .reply(302, '', { Location: `${ACCOUNT}/pass/serviceLoginAuth2/end?x=1` })
    .get('/pass/serviceLoginAuth2/end')
    .query(true)
    .reply(302, '', {
      Location: 'https://sts.api.io.mi.com/sts?d=1',
      'extension-pragma': '{"ssecurity":"U1NFQw=="}',
      'Set-Cookie': ['passToken=PT; Path=/', 'userId=42; Path=/'],
    });
  nock('https://sts.api.io.mi.com')
    .get('/sts')
    .query(true)
    .reply(200, 'ok', { 'Set-Cookie': ['serviceToken=ST; Path=/', 'userId=42; Path=/'] });
}

describe('XiaomiAuth', () => {
  const auth = new XiaomiAuth();

  it('flujo completo: captcha -> código email -> credenciales', async () => {
    mockServiceLogin();
    nock(ACCOUNT)
      .post('/pass/serviceLoginAuth2')
      .query((q) => q.user === 'user@test.com' && !q.captCode)
      .reply(200, `${PREFIX}{"code":87001,"captchaUrl":"/pass/getCode?icodeType=login"}`)
      .get('/pass/getCode')
      .query(true)
      .reply(200, Buffer.from([0xff, 0xd8, 0xff]), {
        'Content-Type': 'image/jpeg',
        'Set-Cookie': 'captchaSession=CS; Path=/',
      });

    const step1 = await auth.start({ username: 'user@test.com', password: 'pw' });
    expect(step1.status).toBe(LoginStatus.CAPTCHA_REQUIRED);
    expect(step1.captcha.image).toBe('data:image/jpeg;base64,/9j/');
    expect(step1.captchaRetry).toBe(false);

    // El estado tiene que sobrevivir a JSON (se guardará en BD/Redis entre peticiones)
    const state1 = JSON.parse(JSON.stringify(step1.state));

    nock(ACCOUNT)
      .post('/pass/serviceLoginAuth2')
      .matchHeader('cookie', /captchaSession=CS/)
      .query((q) => q.captCode === 'abcd')
      .reply(
        200,
        `${PREFIX}{"notificationUrl":"${ACCOUNT}/identity/authStart?sid=xiaomiio&context=${CTX}"}`,
      );
    mockTwoFactorStart();

    const step2 = await auth.submitCaptcha(state1, 'abcd');
    expect(step2.status).toBe(LoginStatus.EMAIL_CODE_REQUIRED);

    mockTwoFactorFinish();
    const step3 = await auth.submitEmailCode(JSON.parse(JSON.stringify(step2.state)), '123456');

    expect(step3.status).toBe(LoginStatus.AUTHENTICATED);
    expect(step3.credentials).toMatchObject({
      userId: '42',
      serviceToken: 'ST',
      ssecurity: 'U1NFQw==',
      passToken: 'PT',
    });
    expect(nock.isDone()).toBe(true);
  });

  it('código de email incorrecto lanza INVALID_EMAIL_CODE', async () => {
    mockServiceLogin();
    nock(ACCOUNT)
      .post('/pass/serviceLoginAuth2')
      .query(true)
      .reply(200, `${PREFIX}{"notificationUrl":"${ACCOUNT}/identity/authStart?context=${CTX}"}`);
    mockTwoFactorStart();

    const { state } = await auth.start({ username: 'u', password: 'p' });

    nock(ACCOUNT)
      .post('/identity/auth/verifyEmail')
      .query(true)
      .reply(200, `${PREFIX}{"code":70014,"tips":"wrong code"}`);

    await expect(auth.submitEmailCode(state, '000000')).rejects.toMatchObject({
      code: 'INVALID_EMAIL_CODE',
    });
  });

  it('login directo sin 2FA', async () => {
    mockServiceLogin();
    nock(ACCOUNT)
      .post('/pass/serviceLoginAuth2')
      .query(true)
      .reply(
        200,
        `${PREFIX}{"ssecurity":"U1NFQw==","userId":42,"passToken":"PT","location":"https://sts.api.io.mi.com/sts?d=1"}`,
      );
    nock('https://sts.api.io.mi.com')
      .get('/sts')
      .query(true)
      .reply(200, 'ok', { 'Set-Cookie': 'serviceToken=ST; Path=/' });

    const result = await auth.start({ username: 'u', password: 'p' });
    expect(result.status).toBe(LoginStatus.AUTHENTICATED);
    expect(result.credentials).toMatchObject({ userId: '42', serviceToken: 'ST', passToken: 'PT' });
  });

  it('contraseña incorrecta lanza INVALID_CREDENTIALS', async () => {
    mockServiceLogin();
    nock(ACCOUNT).post('/pass/serviceLoginAuth2').query(true).reply(200, `${PREFIX}{"code":70016}`);
    await expect(auth.start({ username: 'u', password: 'bad' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('contraseña incorrecta aunque Xiaomi pida otro captcha → INVALID_CREDENTIALS', async () => {
    mockServiceLogin();
    nock(ACCOUNT)
      .post('/pass/serviceLoginAuth2')
      .query(true)
      .reply(200, `${PREFIX}{"code":70016,"captchaUrl":"/pass/getCode?icodeType=login"}`);
    await expect(auth.start({ username: 'u', password: 'bad' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('rechaza estados inválidos o del paso equivocado', async () => {
    await expect(auth.submitCaptcha({}, 'x')).rejects.toMatchObject({
      code: 'INVALID_LOGIN_STATE',
    });

    mockServiceLogin();
    nock(ACCOUNT)
      .post('/pass/serviceLoginAuth2')
      .query(true)
      .reply(200, `${PREFIX}{"captchaUrl":"/pass/getCode"}`)
      .get('/pass/getCode')
      .reply(200, Buffer.from([1]), { 'Content-Type': 'application/octet-stream' });
    const { state, captcha } = await auth.start({ username: 'u', password: 'p' });
    expect(captcha.mimeType).toBe('image/jpeg');

    await expect(auth.submitEmailCode(state, '1')).rejects.toMatchObject({
      code: 'INVALID_LOGIN_STATE',
    });
  });

  it('refresh renueva el serviceToken con passToken', async () => {
    nock(ACCOUNT)
      .get('/pass/serviceLogin')
      .query(true)
      .matchHeader('cookie', /passToken=PT/)
      .reply(
        200,
        `${PREFIX}{"ssecurity":"TkVX","userId":42,"location":"https://sts.api.io.mi.com/sts?d=2"}`,
      );
    nock('https://sts.api.io.mi.com')
      .get('/sts')
      .query(true)
      .reply(200, 'ok', { 'Set-Cookie': 'serviceToken=ST2; Path=/' });

    const credentials = await auth.refresh({ userId: '42', passToken: 'PT' });
    expect(credentials).toMatchObject({
      userId: '42',
      serviceToken: 'ST2',
      ssecurity: 'TkVX',
      passToken: 'PT',
    });
  });

  it('refresh con passToken caducado lanza SESSION_EXPIRED', async () => {
    mockServiceLogin(); // devuelve _sign en vez de ssecurity => pide login
    await expect(auth.refresh({ userId: '42', passToken: 'OLD' })).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });
});
