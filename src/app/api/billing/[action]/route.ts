import { openPortal, startCheckout } from "../../../../server/billing";
import { AppError } from "../../../../server/errors";
import { requireUser, respond, sameOrigin } from "../../../../server/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return respond(async () => {
    sameOrigin(request);
    const user = await requireUser();
    const { action } = await context.params;
    if (action === "checkout") return { url: await startCheckout(user) };
    if (action === "portal") return { url: await openPortal(user.id) };
    throw new AppError("Not found.", 404);
  });
}
