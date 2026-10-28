import { Request, Response } from 'express';
import { z } from 'zod';
import { getRagService } from '../services/rag.service';
import { documentId } from '../utils/http';
import { Errors } from '../utils/errors';

/**
 * Chat input is user text that goes straight to a paid model, so it is bounded and typed: only
 * `user` and `assistant` turns are accepted (a client-supplied `system` turn would let a caller
 * rewrite the assistant's instructions), and the conversation is capped in length and size.
 */
const ChatSchema = z.object({
  messages: z
    .array(
      z.discriminatedUnion('role', [
        z.object({ role: z.literal('user'), content: z.string().trim().min(1).max(4000) }),
        // Earlier assistant answers are echoed back as context and can be long.
        z.object({ role: z.literal('assistant'), content: z.string().trim().min(1).max(16000) }),
      ]),
    )
    .min(1)
    .max(20),
});

function parseMessages(body: unknown) {
  const parsed = ChatSchema.safeParse(body);
  if (!parsed.success) {
    throw Errors.validation('messages must be 1-20 user/assistant turns (questions up to 4,000 characters).');
  }
  if (parsed.data.messages[parsed.data.messages.length - 1]?.role !== 'user') {
    throw Errors.validation('The last message must be from the user.');
  }
  return parsed.data.messages;
}

export async function chatWebsite(req: Request, res: Response): Promise<void> {
  const result = await getRagService().chatPlatform(parseMessages(req.body));
  res.json(result);
}

export async function chatDocument(req: Request, res: Response): Promise<void> {
  const id = documentId(req);
  const result = await getRagService().chatDocument(id, parseMessages(req.body));
  res.json(result);
}
