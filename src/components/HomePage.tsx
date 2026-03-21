import { useEffect } from 'react';

interface HomePageProps {
  onCreateAgreement: () => void;
  ownerName?: string;
  showSuccessBanner?: boolean;
  onDismissBanner?: () => void;
}

export function HomePage({
  onCreateAgreement,
  ownerName,
  showSuccessBanner,
  onDismissBanner,
}: HomePageProps) {
  // Auto-dismiss banner after 5 seconds
  useEffect(() => {
    if (showSuccessBanner && onDismissBanner) {
      const timer = setTimeout(() => {
        onDismissBanner();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [showSuccessBanner, onDismissBanner]);

  return (
    <div className="home-page">
      <div className="home-content">
        {showSuccessBanner ? (
          <div className="success-banner home-success-banner">
            Business profile created successfully
          </div>
        ) : (
          ownerName && <p className="home-greeting">Welcome back, {ownerName}</p>
        )}
        <h1>Cover your ass.</h1>
        <p className="home-description">Work orders and invoices that cover your backend.</p>
        <button className="btn-primary btn-large" onClick={onCreateAgreement}>
          Create Work Order
        </button>
      </div>
    </div>
  );
}
