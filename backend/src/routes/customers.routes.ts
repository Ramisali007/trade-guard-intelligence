import { Router } from 'express';
import { getCustomerDetail, listCustomers } from '../controllers/customer.controller';
import { asyncHandler } from '../utils/http';
import { requirePermission } from '../middleware/auth.middleware';

export const customersRouter = Router();

customersRouter.get('/', requirePermission('customers360.read'), asyncHandler(listCustomers));
customersRouter.get('/:id', requirePermission('customers360.read'), asyncHandler(getCustomerDetail));
