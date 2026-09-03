import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { CustomerProfile } from '../models/api.models';

@Injectable({
  providedIn: 'root',
})
export class CustomersService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/customers';

  listCustomers(search?: string): Observable<CustomerProfile[]> {
    let params = new HttpParams();
    if (search && search.trim()) {
      params = params.set('search', search.trim());
    }
    return this.http.get<CustomerProfile[]>(this.baseUrl, { params });
  }

  getCustomerDetail(customerReferenceId: string): Observable<CustomerProfile> {
    return this.http.get<CustomerProfile>(`${this.baseUrl}/${encodeURIComponent(customerReferenceId)}`);
  }
}
