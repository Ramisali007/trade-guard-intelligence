import { Router } from 'express';
import { getCustomerDetail, listCustomers } from '../controllers/customer.controller';
import { asyncHandler } from '../utils/http';

export const customersRouter = Router();

customersRouter.get('/', asyncHandler(listCustomers));
customersRouter.get('/:id', asyncHandler(getCustomerDetail));
