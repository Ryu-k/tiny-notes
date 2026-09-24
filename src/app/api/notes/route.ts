import { createNote } from "../../../server/notes";
import {
  field,
  jsonBody,
  requireUser,
  respond,
  sameOrigin,
} from "../../../server/http";
export async function POST(request: Request) {
  return respond(async () => {
    sameOrigin(request);
    const user = await requireUser();
    return {
      note: createNote(user.id, field(await jsonBody(request), "body")),
    };
  });
}
