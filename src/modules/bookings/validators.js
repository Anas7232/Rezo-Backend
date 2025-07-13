import { DateTime } from 'luxon';
import { ValidationError } from '../../utils/apiError.js';

export function validateBookingDates(startDate, endDate) {
  if (!startDate || !endDate) {
    throw new ValidationError('Both start and end dates are required');
  }

  const start = DateTime.fromISO(startDate);
  const end = DateTime.fromISO(endDate);
  const now = DateTime.now();

  if (!start.isValid || !end.isValid) {
    throw new ValidationError('Invalid date format. Use ISO format (YYYY-MM-DD)');
  }

  if (end <= start) {
    throw new ValidationError('End date must be after start date');
  }

  if (start < now.startOf('day')) {
    throw new ValidationError('Start date cannot be in the past');
  }
}

export function validateGuests(adults, children, infants) {
  if (!adults || adults < 1) {
    throw new ValidationError('At least one adult is required');
  }

  if (children < 0 || infants < 0) {
    throw new ValidationError('Guest counts cannot be negative');
  }

  if (children + infants > adults * 2) {
    throw new ValidationError('Too many children/infants per adult');
  }
}