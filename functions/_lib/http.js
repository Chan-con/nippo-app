const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function withCors(headers = {}) {
  return { ...corsHeaders, ...headers };
}

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: withCors({ 'Content-Type': 'application/json; charset=utf-8', ...headers }),
  });
}

export function javascriptResponse(js, status = 200, headers = {}) {
  return new Response(js, {
    status,
    headers: withCors({ 'Content-Type': 'application/javascript; charset=utf-8', ...headers }),
  });
}

export async function readJsonBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return null;
  }
  try {
    return await request.json();
  } catch {
    return null;
  }
}
