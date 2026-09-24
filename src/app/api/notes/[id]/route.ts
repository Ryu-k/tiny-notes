import { deleteNote } from "../../../../server/notes";
import { requireUser, respond, sameOrigin } from "../../../../server/http";
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    sameOrigin(request);
    const user = await requireUser();
    deleteNote(user.id, (await context.params).id);
    return { ok: true };
  });
}
