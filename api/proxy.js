export default async function handler(req, res) {
  const { target } = req.query;

  if (!target) {
    res.status(400).json({ error: 'Missing target' });
    return;
  }

  try {
    const response = await fetch(target, {
      method: req.method,
      headers: req.headers,
      body: req.body
    });

    const text = await response.text();
    res.status(response.status);
    res.setHeader('content-type', response.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: error.message || 'Proxy failed' });
  }
}
