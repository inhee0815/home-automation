import type { Handler, HandlerResponse } from '@netlify/functions';

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

export const handler: Handler = async (event): Promise<HandlerResponse> => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      service: 'lg-hood-automation',
    }),
  };
};
