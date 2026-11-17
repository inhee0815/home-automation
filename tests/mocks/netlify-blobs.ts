// Test-only stub: prevents loading ESM-only transitive dependencies of Netlify Blobs.
export const getStore = jest.fn(() => {
  throw new Error('Netlify Blobs not mocked in this test');
});
