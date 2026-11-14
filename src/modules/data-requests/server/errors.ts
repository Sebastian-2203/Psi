import 'server-only';

export const DSR_PRECONDITION_KEYS = {
  request_already_open: 'dataRequests.errors.alreadyOpen',
  request_already_resolved: 'dataRequests.errors.alreadyResolved',
  request_type_not_supported: 'dataRequests.errors.typeNotSupported',
  resolution_summary_required: 'dataRequests.errors.summaryRequired',
  invalid_status_transition: 'dataRequests.errors.invalidTransition',
  due_at_invalid: 'dataRequests.errors.dueDateInvalid',
} as const;
