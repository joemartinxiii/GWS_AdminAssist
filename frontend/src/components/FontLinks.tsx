/**
 * Loads product fonts once per tree (mock parity). Mount under Layout (and Login).
 * Plus Jakarta Sans (UI) + JetBrains Mono (emails / IDs).
 */
export function FontLinks() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
    </>
  );
}
