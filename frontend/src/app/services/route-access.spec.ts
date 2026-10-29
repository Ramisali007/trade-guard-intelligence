import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { AuthService } from './auth.service';
import { RouteAccess } from './route-access';

@Component({ selector: 'app-stub', template: '' })
class StubPage {}

/** A link, button or search result is offered only when the user can open the page behind it. */
describe('RouteAccess', () => {
  const routes: Routes = [
    { path: '', component: StubPage },
    { path: 'dashboard', component: StubPage, data: { anyOf: ['documents.read'] } },
    { path: 'customers', component: StubPage, data: { anyOf: ['customers360.read'] } },
    { path: 'trade-cases/new', component: StubPage, data: { anyOf: ['tradecase.create'] } },
    { path: 'trade-cases/:id', component: StubPage, data: { anyOf: ['tradecase.view.own', 'tradecase.view.all'] } },
    { path: 'workspace', component: StubPage },
  ];
  const held = new Set<string>();
  let stage: 'pre' | 'post' | null = null;
  const auth = { canAny: (...p: string[]) => p.some((x) => held.has(x)), stage: () => stage };
  let access: RouteAccess;

  beforeEach(() => {
    held.clear();
    stage = null;
    TestBed.configureTestingModule({ providers: [provideRouter(routes), { provide: AuthService, useValue: auth }] });
    access = TestBed.inject(RouteAccess);
  });

  it('always offers the public overview and pages that name no permission', () => {
    expect(access.canOpen('/')).toBeTrue();
    expect(access.canOpen('/workspace')).toBeTrue();
  });

  it('offers a page only to a user who holds one of its permissions', () => {
    expect(access.canOpen('/dashboard')).toBeFalse();
    held.add('documents.read');
    expect(access.canOpen('/dashboard')).toBeTrue();
    expect(access.canOpen('/customers')).toBeFalse();
  });

  it('applies the permission of the matching route, including addresses with an id and the more specific route first', () => {
    held.add('tradecase.view.own');
    expect(access.canOpen('/trade-cases/TC-2026-00001')).toBeTrue();
    expect(access.canOpen('/trade-cases/new')).toBeFalse();
    held.add('tradecase.create');
    expect(access.canOpen('/trade-cases/new')).toBeTrue();
  });

  it('ignores the query string and fragment', () => {
    held.add('documents.read');
    expect(access.canOpen('/dashboard?tab=1#top')).toBeTrue();
    expect(access.canOpen('/customers?x=1')).toBeFalse();
  });

  it('does not offer a screen the demo stage hides, even when the role could open it', () => {
    held.add('documents.read');
    stage = 'pre';
    expect(access.canOpen('/dashboard')).toBeFalse();
    stage = 'post';
    expect(access.canOpen('/dashboard')).toBeTrue();
  });

  it('leaves addresses that are not screens of the app alone', () => {
    expect(access.canOpen('/some/unknown/page')).toBeTrue();
  });
});
