import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { adminSupport, auditAdminRow, auditUserRow, BASE } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';
import { renderWithProviders } from '@/test/utils';
import { AuditPage } from './audit-page';
import { classifyActorInput, normalizePhone } from './use-actor-resolution';

const userDetail = { id: 'user-2192', phoneNumber: '+251911002192', fullName: 'Selam D.', status: 'active', trustScore: 70, coinBalance: 1200 };

describe('audit actor input classification', () => {
  it('normalises Ethiopian phone formats and classifies emails / uuids', () => {
    expect(normalizePhone('0911 001 233')).toBe('+251911001233');
    expect(normalizePhone('+251911001233')).toBe('+251911001233');
    expect(normalizePhone('251911001233')).toBe('+251911001233');
    expect(normalizePhone('12345')).toBeNull();
    expect(classifyActorInput(' Finance@RAP.et ')).toEqual({ kind: 'email', value: 'finance@rap.et' });
    expect(classifyActorInput('0911001233')).toEqual({ kind: 'phone', value: '+251911001233' });
    expect(classifyActorInput('5f3c1e2a-7b8d-4c9e-8f1a-2b3c4d5e6f70')).toEqual({ kind: 'uuid', value: '5f3c1e2a-7b8d-4c9e-8f1a-2b3c4d5e6f70' });
    expect(classifyActorInput('bob').kind).toBe('unknown');
    expect(classifyActorInput('').kind).toBe('empty');
  });
});

describe('Audit page actor filter (F9)', () => {
  it('relabels the search box and shows the phone next to user-actor ids', async () => {
    server.use(http.get(`${BASE}/admin/users/:id`, () => HttpResponse.json(userDetail)));
    renderWithProviders(<AuditPage />, { admin: adminSupport, route: '/audit' });
    expect(await screen.findByLabelText('Action or target type')).toBeInTheDocument();
    expect(screen.getByLabelText('Actor')).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: /audit log/i });
    await waitFor(() => {
      expect(within(table).getByText('finance@rap.et')).toBeInTheDocument();
      expect(within(table).getByTestId('actor-phone')).toHaveTextContent('+251911002192');
    });
  });

  it('resolves an admin email to actorId through recent admin rows and filters the log', async () => {
    const user = userEvent.setup();
    const requested: string[] = [];
    server.use(
      http.get(`${BASE}/admin/users/:id`, () => HttpResponse.json(userDetail)),
      http.get(`${BASE}/admin/audit-log`, ({ request }) => {
        const url = new URL(request.url);
        requested.push(url.search);
        if (url.searchParams.get('actorId') === 'admin-finance') return HttpResponse.json({ data: [auditAdminRow], meta: { page: 1, limit: 100, total: 1 } });
        return HttpResponse.json({ data: [auditAdminRow, auditUserRow], meta: { page: 1, limit: 100, total: 2 } });
      }),
    );
    renderWithProviders(<AuditPage />, { admin: adminSupport, route: '/audit' });
    const table = await screen.findByRole('table', { name: /audit log/i });
    await within(table).findByText('deletion_request.created');
    await user.type(screen.getByLabelText('Actor'), 'finance@rap.et');
    const status = await screen.findByTestId('audit-actor-status', {}, { timeout: 4000 });
    await waitFor(() => expect(status).toHaveTextContent('finance@rap.et'));
    expect(status).toHaveTextContent('admin');
    await waitFor(() => expect(requested.some((s) => s.includes('actorId=admin-finance'))).toBe(true));
    await waitFor(() => expect(within(table).queryByText('deletion_request.created')).not.toBeInTheDocument());
    expect(within(table).getByText('withdrawal.approved')).toBeInTheDocument();
  });

  it('resolves a user phone via the users search and reports unknown actors without querying', async () => {
    const user = userEvent.setup();
    const requested: string[] = [];
    server.use(
      http.get(`${BASE}/admin/users`, ({ request }) => {
        const q = new URL(request.url).searchParams.get('q');
        return HttpResponse.json(q === '+251911002192' ? { data: [userDetail], meta: { page: 1, limit: 5, total: 1 } } : { data: [], meta: { page: 1, limit: 5, total: 0 } });
      }),
      http.get(`${BASE}/admin/users/:id`, () => HttpResponse.json(userDetail)),
      http.get(`${BASE}/admin/audit-log`, ({ request }) => {
        requested.push(new URL(request.url).search);
        return HttpResponse.json({ data: [auditUserRow], meta: { page: 1, limit: 100, total: 1 } });
      }),
    );
    renderWithProviders(<AuditPage />, { admin: adminSupport, route: '/audit' });
    const table = await screen.findByRole('table', { name: /audit log/i });
    await within(table).findByText('deletion_request.created');
    const box = screen.getByLabelText('Actor');
    await user.type(box, '0911002192');
    const status = await screen.findByTestId('audit-actor-status', {}, { timeout: 4000 });
    await waitFor(() => expect(status).toHaveTextContent('Selam D. · +251911002192'));
    expect(status).toHaveTextContent('user');
    await waitFor(() => expect(requested.some((s) => s.includes('actorId=user-2192'))).toBe(true));

    const before = requested.length;
    await user.clear(box);
    await user.type(box, '0911999999');
    await waitFor(() => expect(screen.getByTestId('audit-actor-status')).toHaveTextContent('No user with phone +251911999999'));
    expect(await screen.findByText('Actor not resolved')).toBeInTheDocument();
    // nothing with the stale actorId was fetched for the unresolved phone
    expect(requested.slice(before).some((s) => s.includes('actorId='))).toBe(false);
  });
});
