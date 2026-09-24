import { currentUser } from "../server/http";
import { listNotes, planFor } from "../server/notes";
import { Notebook } from "./notebook";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await currentUser();
  return (
    <Notebook
      user={user}
      notes={user ? listNotes(user.id) : []}
      plan={user ? planFor(user.id) : null}
      billingReady={
        !!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") &&
        !!process.env.STRIPE_PRICE_ID &&
        !!process.env.STRIPE_WEBHOOK_SECRET
      }
    />
  );
}
