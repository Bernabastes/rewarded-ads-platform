import type { AuditLogItem, AuditLogMeta, Paginated } from '@rap/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { adminSupport, auditAdminRow, auditUserRow, BASE } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';
import { renderWithProviders } from '@/test/utils';
import { AuditPage } from './audit-page';

/**
 * Server-side actor resolution (P4-F4): the page sends whatever was typed as `actor=`; the API answers with
 * `meta.actorResolved` and `meta.actor` (or an empty page with `actorResolved: false`).
 */
function serverSideAuditLog(requested: string[]) {
  server.use(
    http.get(`${BASE}/admin/audit-log`, ({ request }) => {
      const url = new URL(request.url);
      requested.push(url.search);
      const actor = url.searchParams.get('actor');
      const actorId = url.searchParams.get('actorId');
      const page = (data: AuditLogItem[], extra: Partial<AuditLogMeta> = {}): Paginated<AuditLogItem, AuditLogMeta> => ({ data, meta: { page: 1, limit: 100, total: data.length, ...extra } });
      if (actor === 'finance@rap.et' || actorId === 'admin-finance') return HttpResponse.json(page([auditAdminRow], { actorResolved: true, actor: { id: 'admin-finance', actorType: 'admin', label: 'finance@rap.et' } }));
      if (actor === '0911002192' || actor === '+251911002192' || actorId === 'user-2192') return HttpResponse.json(page([auditUserRow], { actorResolved: true, actor: { id: 'user-2192', actorType: 'user', label: '+251911002192' } }));
      if (actor) return HttpResponse.json(page([], { actorResolved: false, actor: null }));
      return HttpResponse.json(page([auditAdminRow, auditUserRow]));
    }),
  );
}

describe('Audit page actor filter (server-side actor= resolution)', () => {
  it('labels actors from the API (email / phone) without any per-row user lookups', async () => {
    const userLookups: string[] = [];
    server.use(
      http.get(`${BASE}/admin/users/:id`, ({ params }) => {
        userLookups.push(String(params.id));
        return HttpResponse.json({ statusCode: 500, code: 'INTERNAL', message: 'should not be called' }, { status: 500 });
      }),
      http.get(`${BASE}/admin/users`, () => {
        userLookups.push('list');
        return HttpResponse.json({ data: [], meta: { page: 1, limit: 5, total: 0 } });
      }),
    );
    renderWithProviders(<AuditPage />, { admin: adminSupport, route: '/audit' });
    expect(await screen.findByLabelText('Action or target type')).toBeInTheDocument();
    expect(screen.getByLabelText('Actor')).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: /audit log/i });
    await waitFor(() => {
      expect(within(table).getByText('finance@rap.et')).toBeInTheDocument();
      expect(within(table).getByTestId('actor-phone')).toHaveTextContent('+251911002192');
    });
    expect(userLookups).toEqual([]);
    expect(screen.queryByTestId('audit-actor-status')).not.toBeInTheDocument();
  });

  it('sends the typed admin email as actor= (never actorId=), mirrors it in the URL and shows the resolved chip from meta.actor', async () => {
    const user = userEvent.setup();
    const requested: string[] = [];
    serverSideAuditLog(requested);
    const { router } = renderWithProviders(<AuditPage />, { admin: adminSupport, route: '/audit' });
    const table = await screen.findByRole('table', { name: /audit log/i });
    await within(table).findByText('deletion_request.created');

    await user.type(screen.getByLabelText('Actor'), 'finance@rap.et');
    const status = await screen.findByTestId('audit-actor-status', {}, { timeout: 4000 });
    await waitFor(() => expect(status).toHaveTextContent('Actor finance@rap.et'));
    expect(status).toHaveTextContent('admin');
    await waitFor(() => expect(requested.some((s) => s.includes('actor=finance%40rap.et'))).toBe(true));
    expect(requested.some((s) => s.includes('actorId='))).toBe(false);
    expect(router.state.location.search).toContain('actor=finance%40rap.et');
    await waitFor(() => expect(within(table).queryByText('deletion_request.created')).not.toBeInTheDocument());
    expect(within(table).getByText('withdrawal.approved')).toBeInTheDocument();
  });

  it('passes a user phone through verbatim, links the resolved user, and reports unknown actors from meta.actorResolved', async () => {
    const user = userEvent.setup();
    const requested: string[] = [];
    serverSideAuditLog(requested);
    renderWithProviders(<AuditPage />, { admin: adminSupport, route: '/audit' });
    const table = await screen.findByRole('table', { name: /audit log/i });
    await within(table).findByText('withdrawal.approved');

    const box = screen.getByLabelText('Actor');
    await user.type(box, '0911002192');
    const status = await screen.findByTestId('audit-actor-status', {}, { timeout: 4000 });
    await waitFor(() => expect(status).toHaveTextContent('Actor +251911002192'));
    expect(status).toHaveTextContent('user');
    expect(within(status).getByRole('link')).toHaveAttribute('href', '/users/user-2192');
    await waitFor(() => expect(requested.some((s) => s.includes('actor=0911002192'))).toBe(true));
    await waitFor(() => expect(within(table).queryByText('withdrawal.approved')).not.toBeInTheDocument());

    await user.clear(box);
    await user.type(box, 'nobody@rap.et');
    await waitFor(() => expect(screen.getByTestId('audit-actor-status')).toHaveTextContent('No admin, advertiser or user matches nobody@rap.et'), { timeout: 4000 });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText('Actor not found')).toBeInTheDocument();
    expect(requested.some((s) => s.includes('actor=nobody%40rap.et'))).toBe(true);
  });

  it('restores an actor filter from a shared URL and still honours legacy ?actorId= deep links', async () => {
    const requested: string[] = [];
    serverSideAuditLog(requested);
    const first = renderWithProviders(<AuditPage />, { admin: adminSupport, route: '/audit?actor=finance%40rap.et' });
    expect(await screen.findByDisplayValue('finance@rap.et')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('audit-actor-status')).toHaveTextContent('Actor finance@rap.et'));
    expect(requested.at(-1)).toContain('actor=finance%40rap.et');
    first.unmount();

    renderWithProviders(<AuditPage />, { admin: adminSupport, route: '/audit?actorId=user-2192' });
    await waitFor(() => expect(screen.getByTestId('audit-actor-status')).toHaveTextContent('Actor +251911002192'));
    expect(requested.at(-1)).toContain('actorId=user-2192');
    expect(requested.at(-1)).not.toContain('actor=');
  });
});
