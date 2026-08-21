import { Router } from 'express';
import { chatDocument, chatWebsite } from '../controllers/chat.controller';
import { asyncHandler } from '../utils/http';

export const chatRouter = Router();

chatRouter.post('/', asyncHandler(chatWebsite));
chatRouter.post('/document/:id', asyncHandler(chatDocument));
