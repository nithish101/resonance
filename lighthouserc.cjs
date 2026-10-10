// Lighthouse CI (PRD 8: time to interactive < 2 s on broadband). Runs against the production
// build served by `vite preview` with the production headers.
//
// Lighthouse 10+ no longer reports Time to Interactive, so the budget is expressed through the
// metrics that replaced it: Largest Contentful Paint and Total Blocking Time (main-thread
// blocking after first paint), on Lighthouse's default desktop throttling.
module.exports = {
  ci: {
    collect: {
      startServerCommand: "pnpm --filter @resonance/web exec vite preview --port 4174 --strictPort",
      startServerReadyPattern: "Local",
      url: ["http://localhost:4174/"],
      numberOfRuns: 3,
      settings: {
        preset: "desktop",
        chromeFlags: "--headless=new --no-sandbox --disable-audio-output",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.9 }],
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
        "largest-contentful-paint": ["error", { maxNumericValue: 2000 }],
        "total-blocking-time": ["error", { maxNumericValue: 200 }],
      },
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci/reports" },
  },
};
