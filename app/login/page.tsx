export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  const params = (await searchParams) ?? {};
  return (
    <main className="container" style={{ maxWidth: 560 }}>
      <div className="card">
        <img className="login-logo" src="/brand/nae-logo.png" alt="National Art Expressions logo" />

        <p className="muted">Sign in using your username/email and password.</p>
        {params.error && <p style={{ color: "crimson" }}>Login failed. Check your credentials.</p>}
        <form action="/api/auth/login" method="post" className="grid">
          <label>Email or username<input className="input" name="identifier" required /></label>
          <label>Password<input className="input" type="password" name="password" required /></label>
          <button className="btn" type="submit">Sign in</button>
        </form>
      </div>
    </main>
  );
}
