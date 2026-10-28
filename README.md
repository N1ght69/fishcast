# FishCast – web app for iPhone

Bite forecast · fishing map · catch log. Free, no Mac, no Apple account, no API keys.

## Put it online (one time, ~10 minutes, free)

The app must be served over **https** for GPS and the home-screen install to work. GitHub Pages does that for free.

1. Create a free account at **github.com**.
2. Click **+ → New repository**. Name it `fishcast`, set it to **Public**, tick **Add a README file**, then click **Create repository**.
3. Click **Add file → Upload files**. Unzip `fishcast-web.zip` on your computer, open the `fishcast-web` folder, select **everything inside it** (`index.html`, `app.js`, `core.js`, `sw.js`, `manifest.json`, and the `icons` and `vendor` folders), and drag it all into the upload area. Click **Commit changes**.
4. Go to **Settings → Pages**. Under *Branch*, choose **main** and **/ (root)**, then click **Save**.
5. Wait 1–2 minutes. Your app is now at `https://YOUR-USERNAME.github.io/fishcast/`.

> Public repo = the *code* is public. Your catches are **not** uploaded anywhere; they stay on your phone.

## Install on your iPhone

1. Open that link in **Safari** (it must be Safari).
2. Tap **Share → Add to Home Screen → Add**.
3. Open FishCast from the home screen and allow location when asked.

From then on it opens full-screen like a normal app and works offline (forecast from the last load, catch logging, map areas you've already viewed).

## Back up your catches

Catches and spots are stored only inside the app on your phone. Removing the app from the home screen or clearing Safari website data deletes them.

Catch log → **⬆ button → Export backup** → save the file to Files / iCloud Drive. Do it every few weeks. **Restore from file** brings everything back, photos included.

## Updating the app

Upload the changed files to the same GitHub repo (Add file → Upload files, same names overwrite). Close and reopen the app twice; the new version loads.

## How the bite chance works

Each hour is scored from six factors, using the selected species' profile (top of `core.js`):

1. **Water temperature** – biggest factor. Estimated from the last 5 days of air temperature, because no weather service measures lakes. Tap the 🌡 button to enter a real thermometer reading.
2. **Light** – sun angle + clouds. Dawn/dusk boost; light-shy species (zander, catfish, trout) do better when overcast or dark.
3. **Pressure trend** – slowly falling is best, stable is OK, rising after a front is worst.
4. **Wind** – each species has an ideal; very strong wind is penalised.
5. **Rain/storms** – light rain slight plus, heavy rain minus, thunderstorm very low.
6. **Moon (solunar)** – boost near moon overhead/underfoot (major) and moonrise/set (minor).

The day score is the average of the 4 best hours. Weather: Open-Meteo (free).

## Depth map and spot finder (Lithuania)

- **Depth layer** (wave button on the Map): depth bands and contour lines for ~300 Lithuanian lakes, ponds, the Kaunas & Curonian lagoons and the coast, from the public bathymetry service on geoportal.lt. Other places have no free depth data, so nothing shows there.
- **Depth at a pin**: tap the map, and the pin panel shows the depth band at that point.
- **Find spots**: centre one lake on screen and tap it. The app scores the water on a grid using:
  - how well the depth matches what the species wants now (deeper when the water is cold or too warm),
  - drop-offs (how fast the depth changes),
  - shallow shoreline / weed zone (pike, carp, bass),
  - the shore the wind is blowing onto,
  - your own logged catches of that species nearby.
  The best 6 places get numbered markers; tap one for the reasons, to save it, or to see its bite forecast.

This is a rule-based guess from depth, wind and fish behaviour. It does not know about weed beds, stumps, springs or where fish were caught yesterday. Your own catch log is what makes it better over time.

## Stocked lakes (Lithuania)

Green fish markers on the Map = water bodies with official stocking records (orange = a stocking is planned). Tap one to see:
- planned stockings (date + species), which anyone can go and watch,
- stocking history with dates and species,
- official amounts per year and fish age,
- "Fish you can expect here": every species ever stocked + species you've logged within 2 km.

Source: Lithuanian Ministry of Environment fish stocking system (zuvys.biip.lt), open data, records from 2019.
This is not a full species survey: native fish that were never stocked (roach, perch, etc.) don't appear.

## 3-day bite view
The Forecast tab shows best times and the hour-by-hour chart for 3 days starting from the selected day. Switch to "1 day" for a single-day close-up.

### Make it fit your waters
"Model score when caught" on the Catches tab is your reality check. If you keep catching fish when the model said 30 %, the species numbers are off. Edit the `SPECIES` table at the top of `core.js` (e.g. widen `opt`, lower `press`) and re-upload `core.js`.

## Not included
- A shared feed where other people see your catches: that needs accounts and a server.
- Depth charts, fish photo recognition.
- Map tiles: OpenStreetMap (standard) and Esri (satellite), fine for personal use.
