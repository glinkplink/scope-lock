import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

function logMetric(metric: Metric) {
  console.info('[WebVitals]', {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    navigationType: metric.navigationType,
  });
}

export function reportWebVitals() {
  if (!import.meta.env.PROD || typeof window === 'undefined') return;

  onCLS(logMetric);
  onFCP(logMetric);
  onINP(logMetric);
  onLCP(logMetric);
  onTTFB(logMetric);
}
