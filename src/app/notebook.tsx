"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  user: { id: string; email: string } | null;
  notes: { id: string; body: string; createdAt: number }[];
  plan: {
    name: string;
    limit: number;
    status: string;
    cancelAtPeriodEnd: boolean;
    hasCustomer: boolean;
  } | null;
  billingReady: boolean;
};
export function Notebook({ user, notes, plan, billingReady }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [body, setBody] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  async function act(path: string, data?: unknown, method = "POST") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Please try again.");
      if (result.url) {
        window.location.assign(result.url);
        return true;
      }
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <header>
        <a className="brand" href="/">
          ▤ <span>Tiny Notes</span>
        </a>
        <span className="eyebrow">A LITTLE SPACE TO THINK</span>
        {user && (
          <button
            className="quiet"
            disabled={busy}
            onClick={async () => {
              if (await act("/api/auth/logout")) {
                setBody("");
                setDeleting(null);
              }
            }}
          >
            Log out
          </button>
        )}
      </header>
      <div className="intro">
        <span className="kicker">LESS NOISE. MORE IDEAS.</span>
        <h1>
          Keep a little
          <br />
          <em>room for thought.</em>
        </h1>
        <p>
          A reminder, a spark, something worth keeping.
          <br />
          Your notes, in one quiet place.
        </p>
      </div>
      {!user ? (
        <section className="account card">
          <div className="tabs">
            <button
              aria-pressed={mode === "signup"}
              onClick={() => {
                setMode("signup");
                setError("");
              }}
            >
              Create account
            </button>
            <button
              aria-pressed={mode === "login"}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              Log in
            </button>
          </div>
          <h2>{mode === "signup" ? "Start your notebook" : "Welcome back"}</h2>
          <p>Free includes 3 private notes. No card needed.</p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              await act(`/api/auth/${mode}`, {
                email: form.get("email"),
                password: form.get("password"),
              });
            }}
          >
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <small>At least 12 characters.</small>
            <button disabled={busy}>
              {busy
                ? "One moment…"
                : mode === "signup"
                  ? "Create my notebook →"
                  : "Open my notebook →"}
            </button>
          </form>
        </section>
      ) : (
        <div className="workspace">
          <section>
            <div className="section-heading">
              <div>
                <span className="kicker">YOUR NOTEBOOK</span>
                <h2>Small thoughts, kept.</h2>
              </div>
              <span className="count">
                {notes.length} / {plan!.limit} notes
              </span>
            </div>
            <form
              className="composer card"
              onSubmit={async (event) => {
                event.preventDefault();
                if (await act("/api/notes", { body })) {
                  setBody("");
                  setMessage("Note saved.");
                }
              }}
            >
              <label htmlFor="note">What’s on your mind?</label>
              <textarea
                id="note"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={500}
                required
                placeholder="Write something you’d like to remember…"
              />
              <div className="composer-bottom">
                <small>{body.length} / 500</small>
                <button disabled={busy || notes.length >= plan!.limit}>
                  Save note →
                </button>
              </div>
              {notes.length >= plan!.limit && (
                <p>
                  Your notebook is at its limit. Delete a note
                  {plan!.name === "Free"
                    ? " or upgrade to Pro"
                    : " to make room"}
                  .
                </p>
              )}
            </form>
            {!notes.length && (
              <div className="empty">
                <span>✧</span>
                <h3>A fresh page.</h3>
                <p>Your first note belongs right here.</p>
              </div>
            )}
            <ul className="notes">
              {notes.map((note, i) => (
                <li className="card" key={note.id}>
                  <span className="note-number">
                    NOTE {String(notes.length - i).padStart(2, "0")}
                  </span>
                  <p>{note.body}</p>
                  {deleting === note.id ? (
                    <div className="delete-confirm">
                      <span>Delete this note permanently?</span>
                      <button
                        className="quiet"
                        disabled={busy}
                        onClick={() => setDeleting(null)}
                      >
                        Keep note
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await act(
                              `/api/notes/${note.id}`,
                              undefined,
                              "DELETE",
                            )
                          ) {
                            setDeleting(null);
                            setMessage("Note deleted.");
                          }
                        }}
                      >
                        Delete note
                      </button>
                    </div>
                  ) : (
                    <button
                      className="quiet"
                      aria-label={`Delete note ${notes.length - i}`}
                      disabled={busy}
                      onClick={() => setDeleting(note.id)}
                    >
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <aside className="card plan">
            <span className="kicker">A LITTLE MORE ROOM</span>
            <h2>{plan!.name} notebook</h2>
            <p>{user.email}</p>
            <div className="plan-limit">
              {plan!.limit}
              <span>private notes</span>
            </div>
            <p>
              {plan!.name === "Free"
                ? "A small collection for everyday thoughts. Pro makes room for 20."
                : "More space for the ideas you want to keep."}
            </p>
            {plan!.cancelAtPeriodEnd && (
              <p>
                Cancellation scheduled. Pro stays available until the paid
                period ends.
              </p>
            )}
            {plan!.status !== "none" && (
              <small>Subscription: {plan!.status}</small>
            )}
            {plan!.name === "Free" && (
              <button
                disabled={busy || !billingReady}
                onClick={() => act("/api/billing/checkout")}
              >
                Get Pro →
              </button>
            )}
            {plan!.hasCustomer && (
              <button
                className="quiet"
                disabled={busy || !billingReady}
                onClick={() => act("/api/billing/portal")}
              >
                Manage subscription
              </button>
            )}
            <button
              className="quiet"
              disabled={busy}
              onClick={() => {
                router.refresh();
                setMessage(
                  "Plan refreshed. After checkout, allow a moment for the payment update.",
                );
              }}
            >
              Refresh plan
            </button>
            <small>
              {billingReady
                ? "Stripe test mode · no real charges. Price is shown at checkout. Your plan changes after Stripe confirms it."
                : "Free notes are ready. Configure Stripe test mode to try Pro."}
            </small>
          </aside>
        </div>
      )}
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
      )}
      <footer>
        Tiny Notes <span>Just enough space for something good.</span>
      </footer>
    </main>
  );
}
