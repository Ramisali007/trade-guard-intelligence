import { Router } from 'express';
import { chatDocument, chatWebsite } from '../controllers/chat.controller';
import { rateLimit } from '../middleware/rate-limit.middleware';
import { requirePermission } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/http';

export const chatRouter = Router();

// Every message is a paid model call; the general API limit (600 a minute) is far too loose for that.
const chatRateLimit = rateLimit({
  scope: 'chat',
  byUser: true,
  windowMs: 60_000,
  max: 20,
  message: 'That is a lot of questions in one minute. Please wait a moment before asking again.',
});

chatRouter.post('/', requirePermission('chat.use'), chatRateLimit, asyncHandler(chatWebsite));
chatRouter.post('/document/:id', requirePermission('chat.use'), chatRateLimit, asyncHandler(chatDocument));
