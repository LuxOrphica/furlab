# line-direction-visualizer-react

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Environment

Copy `.env.example` to `.env` and adjust values:

- `VITE_APP_VERSION`: UI version label in sidebar.
- `VITE_API_BASE_URL`: explicit API base URL.  
  If empty, app uses fallback `protocol://{current-host}:5500`.
