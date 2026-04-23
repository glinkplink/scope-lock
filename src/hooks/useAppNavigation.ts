import { useMemo } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';

export type AppView =
  | 'home'
  | 'form'
  | 'preview'
  | 'profile'
  | 'clients'
  | 'work-orders'
  | 'work-order-detail'
  | 'co-detail'
  | 'change-order-wizard'
  | 'invoice-wizard'
  | 'invoice-final'
  | 'invoices'
  | 'auth';

export type AppRouteParams = {
  jobId?: string;
  coId?: string;
  invoiceId?: string;
  startSection?: 'top' | 'change-orders';
};

function withQuery(pathname: string, params: AppRouteParams): string {
  const search = new URLSearchParams();
  if (params.startSection === 'change-orders') {
    search.set('section', 'change-orders');
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function pathForView(view: AppView, params: AppRouteParams = {}): string {
  switch (view) {
    case 'home':
      return '/';
    case 'auth':
      return '/auth';
    case 'profile':
      return '/profile';
    case 'clients':
      return '/clients';
    case 'work-orders':
      return '/work-orders';
    case 'work-order-detail':
      return withQuery(`/work-orders/${params.jobId ?? ''}`, params);
    case 'co-detail':
      return `/work-orders/${params.jobId ?? ''}/change-orders/${params.coId ?? ''}`;
    case 'change-order-wizard':
      return params.coId
        ? `/work-orders/${params.jobId ?? ''}/change-orders/${params.coId}/edit`
        : `/work-orders/${params.jobId ?? ''}/change-orders/new`;
    case 'invoice-wizard':
      if (params.coId) {
        return params.invoiceId
          ? `/work-orders/${params.jobId ?? ''}/change-orders/${params.coId}/invoice/${params.invoiceId}/edit`
          : `/work-orders/${params.jobId ?? ''}/change-orders/${params.coId}/invoice/new`;
      }
      return params.invoiceId
        ? `/work-orders/${params.jobId ?? ''}/invoice/${params.invoiceId}/edit`
        : `/work-orders/${params.jobId ?? ''}/invoice/new`;
    case 'invoice-final':
      return `/invoices/${params.invoiceId ?? ''}`;
    case 'invoices':
      return '/invoices';
    case 'form':
      return '/work-order/new';
    case 'preview':
      return '/work-order/new/preview';
    default:
      return '/';
  }
}

export function useAppNavigation() {
  const location = useLocation();
  const navigate = useNavigate();

  const route = useMemo(() => {
    const section = new URLSearchParams(location.search).get('section');
    const startSection = section === 'change-orders' ? 'change-orders' : 'top';

    const invoiceFinal = matchPath('/invoices/:invoiceId', location.pathname);
    if (invoiceFinal) {
      return {
        view: 'invoice-final' as AppView,
        params: { invoiceId: invoiceFinal.params.invoiceId },
      };
    }
    if (location.pathname === '/invoices') {
      return { view: 'invoices' as AppView, params: {} };
    }
    if (location.pathname === '/auth') {
      return { view: 'auth' as AppView, params: {} };
    }
    if (location.pathname === '/profile') {
      return { view: 'profile' as AppView, params: {} };
    }
    if (location.pathname === '/clients') {
      return { view: 'clients' as AppView, params: {} };
    }
    if (location.pathname === '/work-order/new/preview') {
      return { view: 'preview' as AppView, params: {} };
    }
    if (location.pathname === '/work-order/new') {
      return { view: 'form' as AppView, params: {} };
    }
    if (location.pathname === '/work-orders') {
      return { view: 'work-orders' as AppView, params: {} };
    }

    const coInvoiceEdit = matchPath(
      '/work-orders/:jobId/change-orders/:coId/invoice/:invoiceId/edit',
      location.pathname
    );
    if (coInvoiceEdit) {
      return { view: 'invoice-wizard' as AppView, params: coInvoiceEdit.params };
    }
    const coInvoiceNew = matchPath('/work-orders/:jobId/change-orders/:coId/invoice/new', location.pathname);
    if (coInvoiceNew) {
      return { view: 'invoice-wizard' as AppView, params: coInvoiceNew.params };
    }
    const woInvoiceEdit = matchPath('/work-orders/:jobId/invoice/:invoiceId/edit', location.pathname);
    if (woInvoiceEdit) {
      return { view: 'invoice-wizard' as AppView, params: woInvoiceEdit.params };
    }
    const woInvoiceNew = matchPath('/work-orders/:jobId/invoice/new', location.pathname);
    if (woInvoiceNew) {
      return { view: 'invoice-wizard' as AppView, params: woInvoiceNew.params };
    }

    const coEdit = matchPath('/work-orders/:jobId/change-orders/:coId/edit', location.pathname);
    if (coEdit) {
      return { view: 'change-order-wizard' as AppView, params: coEdit.params };
    }
    const coNew = matchPath('/work-orders/:jobId/change-orders/new', location.pathname);
    if (coNew) {
      return { view: 'change-order-wizard' as AppView, params: coNew.params };
    }
    const coDetail = matchPath('/work-orders/:jobId/change-orders/:coId', location.pathname);
    if (coDetail) {
      return { view: 'co-detail' as AppView, params: coDetail.params };
    }
    const woDetail = matchPath('/work-orders/:jobId', location.pathname);
    if (woDetail) {
      return {
        view: 'work-order-detail' as AppView,
        params: { ...woDetail.params, startSection },
      };
    }

    return { view: 'home' as AppView, params: {} };
  }, [location.pathname, location.search]);

  const navigateTo = (newView: AppView, params: AppRouteParams = {}) => {
    navigate(pathForView(newView, params));
  };

  const replaceView = (next: AppView, params: AppRouteParams = {}) => {
    navigate(pathForView(next, params), { replace: true });
  };

  return {
    view: route.view,
    routeParams: route.params as AppRouteParams,
    navigateTo,
    replaceView,
  };
}
