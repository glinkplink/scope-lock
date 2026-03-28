import type { EsignJobStatus } from '../types/db';

export interface EsignProgressStep {
  key: 'sent' | 'opened' | 'completed';
  label: string;
  tone: 'inactive' | 'active' | 'success' | 'danger' | 'warning';
}

export interface EsignProgressModel {
  title: string;
  summary: string;
  steps: [EsignProgressStep, EsignProgressStep, EsignProgressStep];
}

function buildBaseSteps(): [EsignProgressStep, EsignProgressStep, EsignProgressStep] {
  return [
    { key: 'sent', label: 'Sent', tone: 'inactive' },
    { key: 'opened', label: 'Opened', tone: 'inactive' },
    { key: 'completed', label: 'Signed', tone: 'inactive' },
  ];
}

export function getEsignProgressModel(status: EsignJobStatus): EsignProgressModel {
  const steps = buildBaseSteps();

  switch (status) {
    case 'sent':
      steps[0].tone = 'active';
      return { title: 'Sent', summary: 'Signature request sent to customer.', steps };
    case 'opened':
      steps[0].tone = 'active';
      steps[1].tone = 'active';
      return { title: 'Opened', summary: 'Customer has opened the signing link.', steps };
    case 'completed':
      steps[0].tone = 'active';
      steps[1].tone = 'active';
      steps[2].tone = 'success';
      return { title: 'Signed', summary: 'Work order has been signed.', steps };
    case 'declined':
      steps[0].tone = 'active';
      steps[1].tone = 'active';
      steps[2].label = 'Declined';
      steps[2].tone = 'danger';
      return { title: 'Declined', summary: 'Customer declined the work order.', steps };
    case 'expired':
      steps[0].tone = 'active';
      steps[2].label = 'Expired';
      steps[2].tone = 'warning';
      return { title: 'Expired', summary: 'Signature request expired before completion.', steps };
    case 'not_sent':
    default:
      return { title: 'Not sent', summary: 'Ready to send for signature.', steps };
  }
}
