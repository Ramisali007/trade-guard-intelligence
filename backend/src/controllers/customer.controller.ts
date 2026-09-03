import type { Request, Response } from 'express';
import { CustomerRepository } from '../services/customer.repository';
import { Errors } from '../utils/errors';

const customerRepo = CustomerRepository.getInstance();

export async function listCustomers(req: Request, res: Response): Promise<void> {
  const search = typeof req.query['search'] === 'string' ? req.query['search'].toLowerCase().trim() : '';
  const all = await customerRepo.listAll();

  if (!search) {
    res.json(all);
    return;
  }

  const filtered = all.filter(
    (c) =>
      c.customerReferenceId.toLowerCase().includes(search) ||
      c.legalName.toLowerCase().includes(search) ||
      c.normalizedName.toLowerCase().includes(search) ||
      (c.taxVatNumber && c.taxVatNumber.toLowerCase().includes(search)) ||
      (c.registrationNumber && c.registrationNumber.toLowerCase().includes(search)) ||
      c.aliases.some((a) => a.toLowerCase().includes(search)),
  );

  res.json(filtered);
}

export async function getCustomerDetail(req: Request, res: Response): Promise<void> {
  const id = typeof req.params['id'] === 'string' ? req.params['id'] : '';
  if (!id) {
    throw Errors.validation('Customer reference id is required.');
  }

  const customer = await customerRepo.findById(id);
  if (!customer) {
    throw Errors.notFound(`Customer with reference ID "${id}" was not found.`);
  }

  res.json(customer);
}
