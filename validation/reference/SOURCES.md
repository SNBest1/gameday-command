# Validation reference sources

The raw files are **not committed**. `validation/fetch-reference.ts` downloads them to
`validation/reference/raw/` (gitignored) and checks the SHA-256 below. The committed
files are the derived tables:

- `speed-density.csv`
- `bottleneck-flow.csv`

Regenerate them with:

```bash
node validation/fetch-reference.ts
node validation/derive-reference.ts
```

Download date: 2026-10-31.

## Licence and attribution

The Jülich data archive is published by the Institute for Advanced Simulation 7:
Civil Safety Research, Forschungszentrum Jülich. The archive page states that the
data may be used for research as long as the source is named, and that content is
licensed under **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/).
Archive DOI: **10.34735/ped.da**.

## Downloaded files

| File | URL | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `corridor/2013unidirectional_metadata.json` | http://ped.fz-juelich.de/experiments/2013.06.19_Duesseldorf_Messe_BaSiGo/data/2013unidirectional/2013unidirectional_metadata.json | 12,120 | `2c1635c73225f8bb36291adeefd4db5831f64c2ced7da5793c266acf0ec3d2c2` |
| `corridor/traj_UNI_CORR_500_05.txt` | http://ped.fz-juelich.de/experiments/2013.06.19_Duesseldorf_Messe_BaSiGo/result/corrected/UNI_CORR_500_Gregor/traj_UNI_CORR_500_05.txt | 11,008,784 | `a31c2a95b83c737415c7d6fcf24d9ef75ab53c20d85ad776974d5c3e645b08a3` |
| `bottleneck/2005bottleneck1_metadata.json` | http://ped.fz-juelich.de/experiments/2005.12.07_Juelich_Rotunde_Bottleneck/data/2005bottleneck1_metadata.json | 20,896 | `03d95ccf4d5e1716fca9c0107a0f14fd8b83881d70c4737b41fa85a879f9eef7` |
| `bottleneck/trajectories_txt.zip` | http://ped.fz-juelich.de/experiments/2005.12.07_Juelich_Rotunde_Bottleneck/data/trajectories_txt.zip | 92,656 | `59b11bda136d4660e61a623900e7f0f3028254f3d07c8da2997f2f44537bce46` |

The ZIP contains 15 trajectory files for widths 0.8, 0.9, 1.0, 1.1 and 1.2 m with
20, 40 and 60 participants. `fetch-reference.ts` extracts those `.txt` files under
`raw/bottleneck/`.

## Bottleneck method (`bottleneck-flow.csv`)

Experiment: `bottleneck1`, “Bottleneck, Rotunde”, DOI 10.34735/ped.2005.2.

The crossing line is the center of the bottleneck at **y = 0.4 m**, measured in the
direction of movement (negative y). This follows Seyfried et al., *New insights into
pedestrian flow through bottlenecks*, arXiv:physics/0702004, §3.1: “The time interval
Δt between the passage of the first person and last person is measured at the center
of the bottleneck at y=0.4 m.” The archive readme only gives the column format, so
the paper supplies the position.

For each run:

1. Build each person’s trajectory from `ID, time, X, Y`, with time `s:frame` at 25 fps.
2. Interpolate the crossing time linearly between the last sample above the line and
   the first sample at or below it. Sort the crossings by time; let `N` be the number
   of crossings.
3. `k = ceil(0.1 * N)`. Take 1-based crossing `k+1` and crossing `N-k`.
4. `J = ((N-k) - (k+1)) / (t[N-k] - t[k+1])` — intervals divided by time, not people
   divided by time. For N=20, k=2, so this uses crossings 3 through 18.
5. `Js = J / width`.
6. Also record the first-to-last value from the paper’s Table 2: `J_first_last =
   N / (t[N] - t[1])` and `Js_first_last = J_first_last / width`.

The CSV columns are `width_m, participants, crossings, J, Js, J_first_last,
Js_first_last`. `participants` is the run’s nominal group size; `crossings` is the
number of people whose trajectory crossed y=0.4 m.

## Corridor method (`speed-density.csv`)

Experiment: `corridor5`, “Pedestrian flow in a unidirectional corridor”, DOI
10.34735/ped.2013.6. Run `UNI_CORR_500_05`, the 5 m entrance / 5 m exit run, at 25 fps.

The corridor readme gives no measurement area. Accepted fallback: a **2 m long
stretch in the middle of the 18 m corridor, across its full 5 m width**. The run
geometry places the corridor between y=0 m and y=5 m and the middle at x=0, so the
area is x in [-1, 1] m, y in [0, 5] m, area = 10 m².

For each frame:

1. `density = persons inside the area / 10 m²`.
2. For each person inside, estimate position at `t - 0.2 s` and `t + 0.2 s` by linear
   interpolation along that person’s trajectory, then take
   `speed = distance / 0.4 s`.
3. Bin density in 0.25 p/m² steps. Report the mean and sample standard deviation of
   speed per bin, and the number of person-frame samples.

This is the classical method; the 0.4 s window is centered on the frame. The CSV
columns are `density_min_p_m2, density_max_p_m2, mean_speed_mps, std_speed_mps,
samples`.

## Weidmann (1993) — fitted curve, not a measurement

This row is recorded as the fitted relation already used by `densityFactor()` in
`engine/src/movement-flow.ts`, not as an empirical measurement from this suite:

- Source: U. Weidmann, *Transporttechnik der Fußgänger*, Schriftenreihe des IVT 90,
  ETH Zürich, 1993; parameters as cited in the `densityFactor()` comment.
- Free flow up to 0.5 p/m².
- `v = v_free * (1 - exp(-1.913 * (1/rho - 1/rho_jam)))`, with `rho_jam = 5.4 p/m²`.
- Speed floor: 5% of free speed.

Because the model uses this curve, a model-versus-Weidmann comparison checks the
implementation, not reality. The empirical reference is the Jülich data above.
