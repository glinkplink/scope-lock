// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import type { BusinessProfile, Invoice, Job } from '../../types/db';
import App from '../../App';

const getJobById = vi.fn();
const getInvoice = vi.fn();
const getInvoiceByJobId = vi.fn();
const getChangeOrderById = vi.fn();

const profile: BusinessProfile = {
  id: 'p1',
  user_id: 'u1',
  business_name: 'Forge LLC',
  owner_name: 'Alex Smith',
  phone: null,
  email: 'alex@example.com',
  address: null,
  google_business_profile_url: null,
  default_exclusions: [],
  default_assumptions: [],
  next_wo_number: 1,
  next_invoice_number: 1,
  default_warranty_period: 0,
  default_negotiation_period: 0,
  default_payment_methods: [],
  default_tax_rate: 0,
  default_late_payment_terms: '',
  default_payment_terms_days: 0,
  default_late_fee_rate: 0,
  default_card_fee_note: false,
  stripe_account_id: null,
  stripe_onboarding_complete: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

vi.mock('../../hooks/useAuthProfile', () => ({
  useAuthProfile: () => ({
    user: { id: 'u1' },
    authLoading: false,
    profile,
    profileLoading: false,
    setProfile: vi.fn(),
    loadProfile: vi.fn(),
    handleCaptureFlowFinished: vi.fn(),
    stripeConnectNotice: null,
  }),
}));

vi.mock('../../hooks/useWorkOrderDraft', () => ({
  useWorkOrderDraft: () => ({
    state: {
      job: {},
      currentJobId: null,
      woCounterPersistError: null,
      showUnsavedModal: false,
    },
    actions: {
      createNewAgreement: vi.fn(),
      setJob: vi.fn(),
      handleSaveSuccess: vi.fn(),
      dismissWoCounterError: vi.fn(),
      closeUnsavedModal: vi.fn(),
      continueEditingWorkOrder: vi.fn(),
      doCreateNewAgreement: vi.fn(),
    },
  }),
}));

vi.mock('../../hooks/useInvoiceFlow', () => ({
  useInvoiceFlow: () => ({
    state: {
      refreshKey: 0,
      invoiceFlowJob: null,
      activeInvoice: null,
      invoiceFlowChangeOrder: null,
      invoiceFlowTarget: 'job',
      wizardExistingInvoice: null,
    },
    actions: {
      handleStartInvoice: vi.fn(),
      handleOpenPendingInvoice: vi.fn(),
      handleStartChangeOrderInvoice: vi.fn(),
      handleOpenPendingChangeOrderInvoice: vi.fn(),
      handleInvoiceWizardCancel: vi.fn(),
      handleInvoiceWizardSuccess: vi.fn(),
      handleInvoiceFinalBack: vi.fn(),
      handleEditInvoice: vi.fn(),
      handleInvoiceUpdated: vi.fn(),
      resetInvoiceFlow: vi.fn(),
    },
  }),
}));

vi.mock('../../hooks/useChangeOrderFlow', () => ({
  useChangeOrderFlow: () => ({
    state: {
      coDetailBackTarget: 'work-order-detail',
      coDetailCO: null,
      changeOrderFlowJob: null,
      wizardExistingCO: null,
    },
    actions: {
      resetFlowForBackToList: vi.fn(),
      handleBackFromCODetail: vi.fn(),
      handleDeleteCOFromDetail: vi.fn(),
      handleStartChangeOrderFromDetail: vi.fn(),
      handleOpenCODetail: vi.fn(),
      handleChangeOrderWizardComplete: vi.fn(),
      handleChangeOrderWizardCancel: vi.fn(),
      handleCoEsignUpdated: vi.fn(),
      handleEditCOFromDetail: vi.fn(),
      resetChangeOrderFlow: vi.fn(),
    },
  }),
}));

vi.mock('../../components/HomePage', () => ({
  HomePage: () => <div>Home Screen</div>,
}));

vi.mock('../../components/AuthPage', () => ({
  AuthPage: () => <div>Auth Screen</div>,
}));

vi.mock('../../components/BusinessProfileForm', () => ({
  BusinessProfileForm: () => <div>Business Profile Form</div>,
}));

vi.mock('../../components/EditProfilePage', () => ({
  EditProfilePage: () => <div>Edit Profile Page</div>,
}));

vi.mock('../../components/JobForm', () => ({
  JobForm: () => <div>Job Form</div>,
}));

vi.mock('../../components/AgreementPreview', () => ({
  AgreementPreview: () => <div>Agreement Preview</div>,
}));

vi.mock('../../components/ClientsPage', () => ({
  ClientsPage: () => <div>Clients Screen</div>,
}));

vi.mock('../../components/InvoiceWizard', () => ({
  InvoiceWizard: () => <div>Invoice Wizard Screen</div>,
}));

vi.mock('../../components/InvoiceFinalPage', () => ({
  InvoiceFinalPage: ({ invoice }: { invoice: Invoice }) => (
    <div>{`Invoice Final ${invoice.id}`}</div>
  ),
}));

vi.mock('../../lib/db/jobs', () => ({
  getJobById: (...args: unknown[]) => getJobById(...args),
}));

vi.mock('../../lib/db/invoices', () => ({
  getInvoice: (...args: unknown[]) => getInvoice(...args),
  getInvoiceByJobId: (...args: unknown[]) => getInvoiceByJobId(...args),
}));

vi.mock('../../lib/db/change-orders', () => ({
  getChangeOrderById: (...args: unknown[]) => getChangeOrderById(...args),
}));

function minimalJob(): Job {
  return {
    id: 'job-1',
    user_id: 'u1',
    client_id: null,
    customer_name: 'Customer',
    customer_phone: null,
    job_location: '123 Main',
    job_type: 'repair',
    other_classification: null,
    asset_or_item_description: 'Gate',
    requested_work: 'Repair hinge',
    materials_provided_by: null,
    installation_included: null,
    grinding_included: null,
    paint_or_coating_included: null,
    removal_or_disassembly_included: null,
    hidden_damage_possible: null,
    price_type: 'fixed',
    price: 100,
    deposit_required: null,
    payment_terms: null,
    target_completion_date: null,
    exclusions: [],
    assumptions: [],
    change_order_required: null,
    workmanship_warranty_days: null,
    status: 'active',
    wo_number: 1,
    agreement_date: null,
    contractor_phone: null,
    contractor_email: null,
    customer_email: null,
    governing_state: null,
    target_start: null,
    deposit_amount: null,
    late_payment_terms: null,
    payment_terms_days: null,
    late_fee_rate: null,
    negotiation_period: null,
    customer_obligations: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    esign_submission_id: null,
    esign_submitter_id: null,
    esign_embed_src: null,
    esign_status: 'completed',
    esign_submission_state: null,
    esign_submitter_state: null,
    esign_sent_at: null,
    esign_opened_at: null,
    esign_completed_at: '2025-01-01T00:00:00Z',
    esign_declined_at: null,
    esign_decline_reason: null,
    esign_signed_document_url: null,
    esign_resent_at: null,
    offline_signed_at: null,
  };
}

function minimalInvoice(): Invoice {
  return {
    id: 'inv-existing',
    user_id: 'u1',
    job_id: 'job-1',
    invoice_number: 1,
    invoice_date: '2025-01-01',
    due_date: '2025-01-15',
    status: 'draft',
    issued_at: null,
    line_items: [],
    stripe_payment_link_id: null,
    stripe_payment_url: null,
    payment_status: 'unpaid',
    paid_at: null,
    subtotal: 100,
    tax_rate: 0,
    tax_amount: 0,
    total: 100,
    payment_methods: [],
    notes: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
}

function renderApp() {
  return render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}

describe('App bottom navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    getJobById.mockResolvedValue(minimalJob());
    getInvoice.mockResolvedValue(null);
    getInvoiceByJobId.mockResolvedValue(null);
    getChangeOrderById.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it('includes Clients and marks it active after navigation', async () => {
    const user = userEvent.setup();
    renderApp();

    const clientsButton = screen.getByRole('button', { name: 'Clients' });
    expect(clientsButton).toBeInTheDocument();
    expect(clientsButton).not.toHaveClass('active');

    await user.click(clientsButton);

    await waitFor(() => {
      expect(screen.getByText('Clients Screen')).toBeInTheDocument();
    });
    expect(clientsButton).toHaveClass('active');
  });

  it('routes direct new work-order invoice URLs to the existing invoice', async () => {
    getInvoiceByJobId.mockResolvedValueOnce(minimalInvoice());
    window.history.replaceState({}, '', '/work-orders/job-1/invoice/new');

    renderApp();

    await waitFor(() => {
      expect(screen.getByText('Invoice Final inv-existing')).toBeInTheDocument();
    });
    expect(screen.queryByText('Invoice Wizard Screen')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/invoices/inv-existing');
  });
});
