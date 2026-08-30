import { handler } from '../../netlify/functions/health';

describe('GET /api/health', () => {
  it('should return ok: true and service name', async () => {
    const response = await handler(
      { httpMethod: 'GET' } as any,
      {} as any
    );

    expect(response).toBeDefined();
    expect(response?.statusCode).toBe(200);

    const body = JSON.parse(response?.body || '{}');
    expect(body).toEqual({
      ok: true,
      service: 'lg-hood-automation',
    });
  });

  it('should return 405 Method Not Allowed for non-GET requests', async () => {
    const response = await handler(
      { httpMethod: 'POST' } as any,
      {} as any
    );

    expect(response?.statusCode).toBe(405);
  });
});
