export function ClientQuotationPrintStyles({ printAreaId }: { printAreaId: string }) {
  return (
    <style>{`
      @media print {
        body * {
          visibility: hidden;
        }

        #${printAreaId},
        #${printAreaId} * {
          visibility: visible;
        }

        #${printAreaId} {
          position: absolute;
          inset: 0;
          width: 100%;
          padding: 24px;
          background: white;
        }

        .no-print {
          display: none !important;
        }
      }
    `}</style>
  );
}
