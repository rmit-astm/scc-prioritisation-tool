# Melbourne SCC investment explorer

A static, practitioner-facing dashboard for examining modelled protected-cycling portfolios at different funding levels. It is designed for GitHub Pages and has no server-side component.

The optimisation, appraisal and spatial processing remain in the companion `emission-bike-optimisation` repository. To refresh the dashboard after a model rerun, run from that repository:

```sh
Rscript scripts/28_export_dashboard_data.R
Rscript scripts/29_sync_dashboard_data.R
```

Then review and commit the changed files in this repository. The GitHub Actions workflow publishes the `main` branch to GitHub Pages.

For the first deployment, a repository administrator must select **Settings → Pages → Source: GitHub Actions**. Subsequent pushes to `main` publish automatically.

## Local preview

The dashboard must be served over HTTP because browsers do not allow `fetch()` from a local `file://` page. From this repository, use any static file server, for example:

```sh
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Interpretation

This is a research prototype for testing whether the spatial priorities and funding response appear sensible. The displayed portfolios are model outputs, not funded projects, detailed designs or delivery recommendations. See the dashboard's “About the evidence” panel for the main limitations.

## Model assumptions

`review.html` provides a concise, plain-language summary of the assumptions
behind the network, costs, behaviour, appraisal and optimisation. It has no
form or backend. Practitioners can email corrections or supporting evidence to
the corresponding author, using project IDs from the investment map when a
comment relates to a specific location.
