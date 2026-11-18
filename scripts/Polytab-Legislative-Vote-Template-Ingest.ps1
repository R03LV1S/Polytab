# Polytab - Legislative Vote Template Generator & Continuous Ingest (LOCAL, $0)
# Framework aligned with C:\Users\User\Desktop\Polytab-Vote-Template-Ingest.ps1
# Generates draft/final templates for national/congressional Policy & Governance Votes:
# bills, resolutions, joint/concurrent resolutions, laws. Middleman-free community
# sentiment votes contrasting community will with representative votes.
#
# Sources (public/free, no key): GovTrack API v2 (best-effort enrichment) + local seed manifest.
# Campaigns: open-ended; timer begins once funding reaches $10,000 (configurable in seed).
# Bounties benefit verified local entities/charities per campaign scope.

param(
  [int]$IntervalHours = 12,
  [switch]$Once,
  [switch]$NoFeeds,
  [switch]$NoPush,
  [string]$RepoPath = "",
  [int]$Congress = 119,
  [switch]$NonInteractive
)

$ErrorActionPreference = "Continue"
$env:GIT_TERMINAL_PROMPT = "0"

function Log([string]$Message) {
  $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  Write-Host "[$ts] $Message"
}

function Pause-Exit([int]$Code = 0) {
  try { Write-Host ""; Read-Host "Press Enter to exit" | Out-Null } catch {}
  exit $Code
}

function Read-LineOrDefault([string]$Prompt, [string]$Default) {
  $v = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($v)) { return $Default }
  return $v
}

function Resolve-RepoRoot([string]$PathIn) {
  if (-not [string]::IsNullOrWhiteSpace($PathIn)) { return $PathIn }
  try {
    $here = $PSScriptRoot
    if ($here) { return (Resolve-Path (Join-Path $here "..")).Path }
  } catch {}
  return (Get-Location).Path
}

$RepoPath = Resolve-RepoRoot $RepoPath
$GeneratorRel = "scripts\generate-legislative-vote-template.js"
$SeedRel = "docs\data\beta\legislative-votes-seed.json"
$DraftCombinedRel = "docs\data\beta\legislative-votes-draft.json"
$FinalCombinedRel = "docs\data\beta\legislative-votes-all.json"
$OutDirRel = "docs\data\beta\legislative-votes"

function Ensure-Generator {
  $p = Join-Path $RepoPath $GeneratorRel
  if (-not (Test-Path $p)) { throw "Generator not found: $p" }
  return $p
}

function Show-RecordSummary($rec, [int]$idx, [int]$total) {
  $leg = $rec.legislation
  $camp = $rec.campaign
  $ben = @(); if ($rec.bounty_if_passed -and $rec.bounty_if_passed.eligible_beneficiaries) { $ben = @($rec.bounty_if_passed.eligible_beneficiaries) }
  Write-Host ""
  Write-Host "[$idx/$total] $($rec.bounty_id)" -ForegroundColor Cyan
  if ($leg) {
    Write-Host "  Measure: $($leg.display_id)  [$($leg.status_label)]  chamber=$($leg.chamber)  congress=$($leg.congress)"
    Write-Host "  Title: $($leg.short_title)"
    Write-Host "  Full:  $($leg.title)"
    if ($leg.source_urls) { Write-Host "  Sources: $(@($leg.source_urls) -join ' | ')" -ForegroundColor DarkGray }
  }
  if ($camp) {
    Write-Host "  Campaign: type=$($camp.type) threshold=`$$($camp.funding_activation_threshold_usd) timer_starts=$($camp.timer_starts)" -ForegroundColor DarkCyan
  }
  Write-Host "  Vote: $($rec.vote.question)"
  Write-Host "  Bounty: $($rec.bounty_if_passed.description)"
  Write-Host "  Criteria: $($rec.bounty_if_passed.destination_criteria)"
  Write-Host "  Beneficiaries: $($ben.Count)"
  for ($i=0; $i -lt [Math]::Min(5, $ben.Count); $i++) {
    $b = $ben[$i]
    Write-Host "    - $($b.name) ($($b.state)) EIN=$($b.ein)"
  }
  if ($rec._review) {
    if (@($rec._review.missing).Count -gt 0) { Write-Host "  MISSING: $($rec._review.missing -join '; ')" -ForegroundColor Yellow }
    if (@($rec._review.placeholders).Count -gt 0) { Write-Host "  PLACEHOLDERS: $($rec._review.placeholders -join ', ')" -ForegroundColor Yellow }
  }
}

function Recompute-Review($rec) {
  $missing = @(); $placeholders = @()
  if (-not $rec.legislation -or -not $rec.legislation.number) { $missing += "legislation.number" }
  if (-not $rec.legislation -or ("$($rec.legislation.title)" -match "TITLE_REQUIRED")) { $placeholders += "legislation.title" }
  if (-not $rec.legislation -or -not $rec.legislation.source_urls -or @($rec.legislation.source_urls).Count -eq 0) { $missing += "legislation.source_urls" }
  if (-not $rec.legislation -or -not $rec.legislation.status -or $rec.legislation.status -eq "unknown") { $placeholders += "legislation.status" }
  if ("$($rec.vote.question)" -match "\[LITMUS TEST\]" -and (-not $rec.legislation -or -not $rec.legislation.short_title)) { $placeholders += "vote.question (add plain-language short_title/summary)" }
  if (-not $rec.bounty_if_passed -or -not $rec.bounty_if_passed.eligible_beneficiaries -or @($rec.bounty_if_passed.eligible_beneficiaries).Count -eq 0) { $placeholders += "bounty_if_passed.eligible_beneficiaries" }
  if ("$($rec.bounty_if_passed.description)" -match "\[BETA_BOUNTY_OUTCOME\]") { $placeholders += "bounty_if_passed.description" }
  $rec._review = [ordered]@{ missing = $missing; placeholders = $placeholders }
  return $rec
}

function Edit-KeyFields($rec) {
  Write-Host "  -- Fill key fields (Enter = keep current) --" -ForegroundColor DarkCyan
  $rec.legislation.short_title = Read-LineOrDefault "  Short title" "$($rec.legislation.short_title)"
  $rec.legislation.summary = Read-LineOrDefault "  Summary" "$($rec.legislation.summary)"
  $rec.legislation.status = Read-LineOrDefault "  Status" "$($rec.legislation.status)"
  $rec.legislation.status_label = Read-LineOrDefault "  Status label" "$($rec.legislation.status_label)"
  $rec.vote.question = Read-LineOrDefault "  Vote question (litmus test)" "$($rec.vote.question)"
  $rec.bounty_if_passed.description = Read-LineOrDefault "  Bounty description" "$($rec.bounty_if_passed.description)"
  $rec.bounty_if_passed.destination_criteria = Read-LineOrDefault "  Bounty criteria" "$($rec.bounty_if_passed.destination_criteria)"
  $scope = Read-LineOrDefault "  Beneficiary scope (national/state/local)" "$($rec.bounty_if_passed.beneficiary_scope)"
  $rec.bounty_if_passed.beneficiary_scope = $scope
  $states = Read-LineOrDefault "  Beneficiary states (comma-separated, e.g. IL,OH)" (($rec.bounty_if_passed.beneficiary_states -join ","))
  $rec.bounty_if_passed.beneficiary_states = @($states.Split(",") | ForEach-Object { $_.Trim().ToUpper().Replace("US-","") } | Where-Object { $_ -ne "" })
  $thr = Read-LineOrDefault "  Funding activation threshold USD (timer starts at)" "$($rec.campaign.funding_activation_threshold_usd)"
  $n = 0; if ([double]::TryParse($thr, [ref]$n)) { $rec.campaign.funding_activation_threshold_usd = [int][math]::Round($n); $rec.metrics.targetUSD = $rec.campaign.funding_activation_threshold_usd }
  return (Recompute-Review $rec)
}

function Interactive-ReviewDrafts {
  $draftCombined = Join-Path $RepoPath $DraftCombinedRel
  if (-not (Test-Path $draftCombined)) { Log "No draft file found at $draftCombined"; return $null }
  try {
    $obj = Get-Content $draftCombined -Raw | ConvertFrom-Json
  } catch { Log "Failed to parse draft JSON: $($_.Exception.Message)"; return $null }

  $records = @()
  if ($obj.PSObject.Properties.Name -contains 'records') { $records = @($obj.records) } else { $records = @($obj) }
  if ($records.Count -eq 0) {
    Log "Draft contains 0 records. Edit seed manifest ($SeedRel), enable entries, and re-run."
    $seedPath = Join-Path $RepoPath $SeedRel
    $openSeed = Read-Host "Open seed manifest now? (y/N)"
    if ($openSeed -match '^(y|Y)' -and (Test-Path $seedPath)) { Start-Process notepad.exe $seedPath }
    return @()
  }

  Write-Host ""; Write-Host "========== REVIEW: $($records.Count) legislative draft record(s) ==========" -ForegroundColor Green
  $approved = @(); $skipAll = $false

  for ($i=0; $i -lt $records.Count; $i++) {
    $rec = $records[$i]; $decision = "P"
    while ($true) {
      Show-RecordSummary $rec ($i+1) $records.Count
      if ($skipAll) { $decision = "A"; break }
      Write-Host ""
      $choice = Read-Host "Action: [A]pprove  [E]dit in Notepad  [F]ill key fields  [S]kip record  [K] Skip rest  [Q]uit review"
      switch -Regex ($choice) {
        '^(?i)a$' { $decision = "A"; break }
        '^(?i)s$' { $decision = "S"; break }
        '^(?i)k$' { $decision = "S"; $skipAll = $true; break }
        '^(?i)q$' { return $null }
        '^(?i)f$' { $rec = Edit-KeyFields $rec; $records[$i] = $rec; continue }
        '^(?i)e$' {
          $tmp = Join-Path $env:TEMP ("polytab-leg-review-" + $rec.bounty_id + ".json")
          $rec | ConvertTo-Json -Depth 40 | Set-Content -Path $tmp -Encoding UTF8
          Start-Process notepad.exe $tmp -Wait
          try { $rec = Get-Content $tmp -Raw | ConvertFrom-Json; $records[$i] = $rec; Log "Reloaded edits for $($rec.bounty_id)" }
          catch { Write-Host "  Failed to parse edited JSON, keeping previous: $($_.Exception.Message)" -ForegroundColor Red }
          Remove-Item $tmp -ErrorAction SilentlyContinue
          continue
        }
        default { Write-Host "Invalid choice."; continue }
      }
      break
    }
    if ($decision -eq "A") { $approved += $rec }
  }

  Write-Host ""; Write-Host "========== FINAL REVIEW ==========" -ForegroundColor Green
  Write-Host "Approved: $(@($approved).Count) / $($records.Count)"
  foreach ($a in $approved) {
    $ph = @(); $ms = @()
    if ($a._review -and $a._review.placeholders) { $ph = @($a._review.placeholders) }
    if ($a._review -and $a._review.missing) { $ms = @($a._review.missing) }
    $flag = if ($ph.Count -gt 0 -or $ms.Count -gt 0) { " [HAS WARNINGS]" } else { "" }
    Write-Host ("  - {0}  {1}{2}" -f $a.bounty_id, $a.legislation.display_id, $flag)
  }
  if (@($approved).Count -eq 0) { Log "No records approved."; return @() }
  $confirm = Read-Host "Finalize approved records? (y=write finals, n=abort)"
  if ($confirm -notmatch '^(y|Y)') { Log "Aborted by user."; return $null }

  $outDir = Join-Path $RepoPath $OutDirRel
  $combined = Join-Path $RepoPath $FinalCombinedRel
  if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
  foreach ($a in $approved) {
    if ($a.PSObject.Properties.Name -contains '_review') { $a.PSObject.Properties.Remove('_review') }
    if ($a.provenance) { $a.provenance.status = "beta_template"; $a.provenance.review_required = $false }
    $path = Join-Path $outDir ("$($a.bounty_id).json")
    $a | ConvertTo-Json -Depth 40 | Set-Content -Path $path -Encoding UTF8
    $dp = Join-Path $outDir ("$($a.bounty_id).draft.json")
    if (Test-Path $dp) { Remove-Item $dp -ErrorAction SilentlyContinue }
    Log "Finalized: $path"
  }
  $finalObj = [ordered]@{
    template_version = "pol-legislative-vote-beta-1"
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    draft = $false
    count = @($approved).Count
    records = $approved
  }
  $finalObj | ConvertTo-Json -Depth 40 | Set-Content -Path $combined -Encoding UTF8
  Log "Finalized combined: $combined"
  return $approved
}

function Run-Cycle {
  param([bool]$Interactive = $true)
  try {
    Set-Location $RepoPath
    Ensure-Generator | Out-Null

    Log "Syncing with origin/main..."
    git fetch origin main 2>&1 | ForEach-Object { Write-Host $_ }
    git pull --rebase --autostash origin main 2>&1 | ForEach-Object { Write-Host $_ }
    $pullExit = $LASTEXITCODE
    $conflicted = (git ls-files -u 2>&1); $conflictedText = if ($conflicted) { "$conflicted" } else { "" }
    $rebaseBusy = (Test-Path (Join-Path $RepoPath ".git\rebase-merge")) -or (Test-Path (Join-Path $RepoPath ".git\rebase-apply")) -or (Test-Path (Join-Path $RepoPath ".git\MERGE_HEAD"))
    if ($pullExit -ne 0 -or $rebaseBusy -or $conflictedText.Trim().Length -gt 0) {
      Log "Sync failed or left conflicts/rebase state (exit=$pullExit). Aborting rebase/merge and stopping this cycle."
      git rebase --abort 2>&1 | ForEach-Object { Write-Host $_ }
      git merge --abort 2>&1 | Out-Null
      throw "Repository sync left conflicts; resolve manually before running ingest."
    }

    $env:CONGRESS = "$Congress"

    if ($Interactive -and -not $NonInteractive) {
      $env:DRAFT = "1"
      Log "Running legislative generator in DRAFT mode (congress=$Congress)..."
      node $GeneratorRel 2>&1 | ForEach-Object { Write-Host $_ }
      Remove-Item Env:\DRAFT -ErrorAction SilentlyContinue
      $finalized = Interactive-ReviewDrafts
      if ($null -eq $finalized) { Log "Review quit/aborted; nothing committed."; return }
      if (@($finalized).Count -eq 0) { Log "Nothing finalized; nothing committed."; return }
    } else {
      Remove-Item Env:\DRAFT -ErrorAction SilentlyContinue
      Log "Running legislative generator (non-interactive final, congress=$Congress)..."
      node $GeneratorRel 2>&1 | ForEach-Object { Write-Host $_ }
    }

    $FeedsScript = Join-Path $RepoPath "scripts\generate-feeds.js"
    if ((-not $NoFeeds) -and (Test-Path $FeedsScript)) {
      Log "Generating feeds..."
      node scripts/generate-feeds.js 2>&1 | ForEach-Object { Write-Host $_ }
    }

    git add -A 2>&1 | Out-Null
    $status = git status --porcelain 2>&1
    if ($status -and $status.Trim().Length -gt 0) {
      $msg = "Legislative vote templates: local ingest " + (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
      $doCommit = $true
      if ($Interactive -and -not $NonInteractive) {
        $c = Read-Host "Commit and push now? (y=commit/push per settings, n=leave changes in working tree)"
        if ($c -notmatch '^(y|Y)') { $doCommit = $false }
      }
      if ($doCommit) {
        Log "Committing..."
        git commit -m $msg 2>&1 | ForEach-Object { Write-Host $_ }
        if (-not $NoPush) { Log "Pushing to origin/main..."; git push origin main 2>&1 | ForEach-Object { Write-Host $_ } }
        else { Log "NoPush set; skipping push." }
      } else {
        Log "Skipped commit/push; changes remain in working tree."
      }
    } else {
      Log "No changes to commit."
    }

    Log "Cycle complete."
    $combined = Join-Path $RepoPath $FinalCombinedRel
    $seedPath = Join-Path $RepoPath $SeedRel
    if (Test-Path $combined) { Log "Output: $combined" }
    if (Test-Path $seedPath) { Log "Seed manifest: $seedPath" }
  } catch {
    Log "Cycle error: $($_.Exception.Message)"
  }
}

function Get-OrCreate-Seed {
  $seedPath = Join-Path $RepoPath $SeedRel
  if (-not (Test-Path $seedPath)) {
    Log "Seed manifest not found; creating starter template..."
    Ensure-Generator | Out-Null
    Set-Location $RepoPath
    $env:CONGRESS = "$Congress"; $env:DRAFT = "1"
    node $GeneratorRel 2>&1 | Out-Null
    Remove-Item Env:\DRAFT -ErrorAction SilentlyContinue
    # clean up empty draft artifacts from starter creation
    $draftCombined = Join-Path $RepoPath $DraftCombinedRel
    if (Test-Path $draftCombined) {
      try { $d = Get-Content $draftCombined -Raw | ConvertFrom-Json; if ($d.count -eq 0) { Remove-Item $draftCombined -ErrorAction SilentlyContinue } } catch {}
    }
  }
  return $seedPath
}

function Quick-Add-Campaigns {
  $seedPath = Get-OrCreate-Seed
  try { $seed = Get-Content $seedPath -Raw | ConvertFrom-Json } catch { Log "Failed to read seed: $($_.Exception.Message)"; return }
  if (-not $seed.campaigns) { $seed | Add-Member -NotePropertyName campaigns -NotePropertyValue @() -Force }
  $campaigns = [System.Collections.ArrayList]@( $seed.campaigns )
  $typeMap = @{
    "1" = "house_bill"; "2" = "house_resolution"; "3" = "house_joint_resolution"; "4" = "house_concurrent_resolution";
    "5" = "senate_bill"; "6" = "senate_resolution"; "7" = "senate_joint_resolution"; "8" = "senate_concurrent_resolution"
  }
  Write-Host ""; Write-Host "=== Quick Add Legislative Campaign(s) ===" -ForegroundColor Green
  Write-Host "Add bills/resolutions/laws to the seed manifest (no JSON editing needed)."
  while ($true) {
    $add = Read-Host "Add a campaign now? (y/N)"
    if ($add -notmatch '^(y|Y)') { break }
    $cng = Read-LineOrDefault "  Congress" "$($seed.congress)"
    $congNum = 0; if (-not [int]::TryParse($cng, [ref]$congNum)) { $congNum = $Congress }
    Write-Host "  Bill type: 1) house_bill 2) house_resolution 3) house_joint_resolution 4) house_concurrent_resolution 5) senate_bill 6) senate_resolution 7) senate_joint_resolution 8) senate_concurrent_resolution"
    $tchoice = Read-Host "  Choose [1-8]"
    $btype = $typeMap["$tchoice"]; if (-not $btype) { $btype = "house_bill" }
    $numStr = Read-Host "  Bill/Resolution number (e.g. 1)"
    $bnum = 0; [void][int]::TryParse($numStr, [ref]$bnum)
    if ($bnum -le 0) { Write-Host "  Skipped (invalid number)." -ForegroundColor Yellow; continue }
    $shortTitle = Read-Host "  Short title (plain language)"
    $summary = Read-Host "  Summary (why communities care)"
    $scope = Read-LineOrDefault "  Beneficiary scope (national/state/local)" "national"
    $statesStr = Read-Host "  Beneficiary states (comma-separated, e.g. IL,OH; blank for national)"
    $statesArr = @($statesStr.Split(",") | ForEach-Object { $_.Trim().ToUpper().Replace("US-","") } | Where-Object { $_ -ne "" })
    $g = [ordered]@{
      enabled = $true
      congress = $congNum
      bill_type = $btype
      number = $bnum
      govtrack_id = $null
      title = if ($shortTitle) { $shortTitle } else { "Campaign for $btype $bnum ($congNum th)" }
      short_title = if ($shortTitle) { $shortTitle } else { $null }
      summary = if ($summary) { $summary } else { $null }
      status = "introduced"
      sponsor = $null
      beneficiary_scope = $scope
      beneficiary_states = $statesArr
      localities = @()
      bounty_description = $null
      bounty_criteria = $null
      campaign_overrides = @{ funding_activation_threshold_usd = 10000; timer_duration_days = $null }
      auto_fetch = $true
    }
    [void]$campaigns.Add([pscustomobject]$g)
    Write-Host "  Added: $btype $bnum ($congNum th) enabled=$true" -ForegroundColor Cyan
  }
  $seed.campaigns = @($campaigns)
  $seed.congress = $Congress
  $seed | ConvertTo-Json -Depth 30 | Set-Content -Path $seedPath -Encoding UTF8
  $enabledCount = @($seed.campaigns | Where-Object { $_.enabled -ne $false -and [int]$_.number -gt 0 }).Count
  Log "Seed saved: $seedPath ($enabledCount enabled campaign(s) ready)."
}

function Auto-Discover-Seed {
  $seedScript = Join-Path $RepoPath "scripts\generate-legislative-vote-seed.js"
  if (-not (Test-Path $seedScript)) { Log "Auto-discovery script not found: $seedScript"; return }
  $lim = Read-LineOrDefault "How many recent/upcoming/active bills & resolutions to discover" "25"
  $mode = Read-LineOrDefault "Mode: merge into existing seed (m) or replace campaigns (r)" "m"
  $env:CONGRESS = "$Congress"
  $env:LIMIT = "$lim"
  if ($mode -match '^(?i)r') { $env:REPLACE = "1" } else { Remove-Item Env:\REPLACE -ErrorAction SilentlyContinue }
  Log "Auto-discovering from keyless official sources (GovInfo RSS, House floor, Senate active legislation)..."
  node $seedScript 2>&1 | ForEach-Object { Write-Host $_ }
  Remove-Item Env:\LIMIT -ErrorAction SilentlyContinue
  Remove-Item Env:\REPLACE -ErrorAction SilentlyContinue
  Log "Discovery complete. Choose option 1 to build drafts for all enabled campaigns, then review/finalize/push."
}

function Open-Official-Sources {
  Write-Host ""; Write-Host "Opening reputable official sources in your browser for manual scrub/review..." -ForegroundColor Green
  $urls = @(
    "https://www.congress.gov/search?q=%7B%22source%22%3A%22legislation%22%2C%22congress%22%3A%22$Congress%22%7D",
    "https://www.congress.gov/legislative-activity",
    "https://docs.house.gov/floor/",
    "https://www.house.gov/legislative-activity",
    "https://clerk.house.gov/Votes",
    "https://www.senate.gov/legislative/active_leg_page.htm",
    "https://www.senate.gov/legislative/floor_activity_pail.htm",
    "https://www.govinfo.gov/app/collection/bills/$Congress",
    "https://www.govinfo.gov/rss/bills.xml"
  )
  foreach ($u in $urls) {
    try { Start-Process $u; Log "Opened: $u" } catch { Log "Failed to open: $u ($($_.Exception.Message))" }
  }
  Write-Host ""
  Write-Host "Tips for manual scrub (no API key, free):" -ForegroundColor DarkCyan
  Write-Host " - Congress.gov: best bill/resolution/vote details (browse manually; API requires key)."
  Write-Host " - House floor (docs.house.gov/floor): bills scheduled/considered this week."
  Write-Host " - House Clerk votes: recent roll-call votes by bill/resolution."
  Write-Host " - Senate active legislation & floor proceedings: active measures and floor activity."
  Write-Host " - GovInfo bills: official publications/RSS."
  Write-Host "After collecting measures, use option 5 (quick add), option 8 (import from file), or edit the seed manifest, then run option 1."
}

function Import-Campaigns-FromFile {
  $seedPath = Get-OrCreate-Seed
  try { $seed = Get-Content $seedPath -Raw | ConvertFrom-Json } catch { Log "Failed to read seed: $($_.Exception.Message)"; return }
  if (-not $seed.campaigns) { $seed | Add-Member -NotePropertyName campaigns -NotePropertyValue @() -Force }
  $campaigns = [System.Collections.ArrayList]@( $seed.campaigns )

  $defaultPath = Join-Path $RepoPath "docs\data\beta\legislative-votes-import.json"
  $path = Read-Host "Path to import file (.json or .csv) [default: $defaultPath]"
  if ([string]::IsNullOrWhiteSpace($path)) { $path = $defaultPath }
  if (-not (Test-Path $path)) {
    # create template if missing
    $dir = Split-Path $path -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if ($path.ToLower().EndsWith('.csv')) {
      @(
        'congress,bill_type,number,title,short_title,summary,beneficiary_scope,beneficiary_states,enabled,auto_fetch',
        '119,house_bill,1,Example Bill,Example Bill,Plain-language summary,national,"",true,true'
      ) | Set-Content -Path $path -Encoding UTF8
    } else {
      @(
        [ordered]@{
          enabled = $true; congress = 119; bill_type = "house_bill"; number = 1; govtrack_id = $null;
          title = "Example Bill"; short_title = "Example Bill"; summary = "Plain-language summary";
          beneficiary_scope = "national"; beneficiary_states = @(); localities = @();
          bounty_description = $null; bounty_criteria = $null;
          campaign_overrides = @{ funding_activation_threshold_usd = 10000; timer_duration_days = $null }; auto_fetch = $true
        }
      ) | ConvertTo-Json -Depth 20 | Set-Content -Path $path -Encoding UTF8
    }
    Log "Import file not found; created template at: $path"
    Log "Fill it with scrubbed campaigns, save, then run import again."
    try { Start-Process notepad.exe $path } catch {}
    return
  }

  $items = @()
  try {
    if ($path.ToLower().EndsWith('.csv')) {
      $items = @(Import-Csv -Path $path)
    } else {
      $raw = Get-Content $path -Raw | ConvertFrom-Json
      if ($null -eq $raw) { $items = @() }
      elseif ($raw -is [System.Array]) { $items = @($raw) }
      elseif ($raw.PSObject.Properties.Name -contains 'campaigns') { $items = @($raw.campaigns) }
      elseif ($raw.PSObject.Properties.Name -contains 'records') { $items = @($raw.records) }
      else { $items = @($raw) }
    }
  } catch {
    Log "Failed to parse import file: $($_.Exception.Message)"
    return
  }

  $added = 0
  foreach ($it in $items) {
    $num = 0; [void][int]::TryParse("$($it.number)", [ref]$num)
    if ($num -le 0) { continue }
    $btype = "$($it.bill_type)"
    if ([string]::IsNullOrWhiteSpace($btype) -and $it.type) { $btype = "$($it.type)" }
    $cong = 0; [void][int]::TryParse("$($it.congress)", [ref]$cong); if ($cong -le 0) { $cong = $Congress }
    $bstates = @()
    if ($it.beneficiary_states) {
      if ($it.beneficiary_states -is [System.Array]) { $bstates = @($it.beneficiary_states | ForEach-Object { "$_".Trim().ToUpper().Replace("US-","") } | Where-Object { $_ -ne "" }) }
      else { $bstates = @("$($it.beneficiary_states)".Split(",") | ForEach-Object { $_.Trim().ToUpper().Replace("US-","") } | Where-Object { $_ -ne "" }) }
    }
    $enabled = $true
    if ($it.PSObject.Properties.Name -contains 'enabled') { $enabled = ("$($it.enabled)" -notmatch '^(?i:false|0|no)$') }
    $autoFetch = $true
    if ($it.PSObject.Properties.Name -contains 'auto_fetch') { $autoFetch = ("$($it.auto_fetch)" -notmatch '^(?i:false|0|no)$') }
    $g = [ordered]@{
      enabled = $enabled
      congress = $cong
      bill_type = $btype
      number = $num
      govtrack_id = $it.govtrack_id
      title = if ($it.title) { "$($it.title)" } else { "Campaign for $btype $num ($cong th)" }
      short_title = if ($it.short_title) { "$($it.short_title)" } else { $(if ($it.title) { "$($it.title)" } else { $null }) }
      summary = if ($it.summary) { "$($it.summary)" } else { $null }
      status = if ($it.status) { "$($it.status)" } else { "introduced" }
      sponsor = $it.sponsor
      beneficiary_scope = if ($it.beneficiary_scope) { "$($it.beneficiary_scope)" } else { "national" }
      beneficiary_states = $bstates
      localities = @()
      bounty_description = $it.bounty_description
      bounty_criteria = $it.bounty_criteria
      campaign_overrides = @{ funding_activation_threshold_usd = 10000; timer_duration_days = $null }
      auto_fetch = $autoFetch
    }
    [void]$campaigns.Add([pscustomobject]$g)
    $added++
  }
  $seed.campaigns = @($campaigns)
  $seed.congress = $Congress
  $seed | ConvertTo-Json -Depth 30 | Set-Content -Path $seedPath -Encoding UTF8
  $enabledCount = @($seed.campaigns | Where-Object { $_.enabled -ne $false -and [int]$_.number -gt 0 }).Count
  Log "Imported $added campaign(s) from $path. Seed now has $enabledCount enabled campaign(s): $seedPath"
}

function Show-Menu {
  Clear-Host
  Write-Host "==============================================================="
  Write-Host " Polytab Legislative Vote Template Ingest (Policy & Governance)"
  Write-Host "==============================================================="
  Write-Host "Repo:        $RepoPath"
  Write-Host "Congress:    $Congress"
  Write-Host "Push:        $(-not $NoPush)   Feeds: $(-not $NoFeeds)   NonInteractive: $NonInteractive"
  Write-Host "Campaign:    open-ended; timer begins once funded >= `$10,000"
  Write-Host "Wallet:      0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08 (Base USDC)"
  Write-Host ""
  Write-Host "  1) Run ONCE (build drafts for all enabled campaigns + review, no push)  [recommended]"
  Write-Host "  2) Run ONCE (build drafts + review, allow commit+push)"
  Write-Host "  3) Run ONCE (non-interactive, finalize enabled campaigns as-is, no push)"
  Write-Host "  4) Run CONTINUOUS (non-interactive, commit+push every $IntervalHours h)"
  Write-Host "  5) Quick add campaign(s) manually (no JSON editing)"
  Write-Host "  6) Auto-discover recent/upcoming/active bills & resolutions (keyless official sources)"
  Write-Host "  7) Open official legislative sources in browser (manual scrub)"
  Write-Host "  8) Import campaigns from file (JSON/CSV scrubbed list)"
  Write-Host "  9) Open seed manifest / output folder"
  Write-Host " 10) Set Congress / interval / flags"
  Write-Host " 11) Exit"
  Write-Host ""
  $choice = Read-Host "Choose [1-11]"
  switch ($choice) {
    "1" { $script:NoPush = $true;  Run-Cycle -Interactive $true; Write-Host ""; Read-Host "Press Enter to return to menu" | Out-Null }
    "2" { $script:NoPush = $false; Run-Cycle -Interactive $true; Write-Host ""; Read-Host "Press Enter to return to menu" | Out-Null }
    "3" { $script:NoPush = $true;  Run-Cycle -Interactive $false; Write-Host ""; Read-Host "Press Enter to return to menu" | Out-Null }
    "4" {
      $script:NoPush = $false; $script:NonInteractive = $true
      while ($true) {
        Run-Cycle -Interactive $false
        $sec = [Math]::Max(1, $IntervalHours) * 3600
        Log "Sleeping for $IntervalHours hour(s)... (Ctrl+C to stop)"
        Start-Sleep -Seconds $sec
      }
    }
    "5" { Quick-Add-Campaigns; Write-Host ""; Read-Host "Press Enter to return to menu" | Out-Null }
    "6" { Auto-Discover-Seed; Write-Host ""; Read-Host "Press Enter to return to menu" | Out-Null }
    "7" { Open-Official-Sources; Write-Host ""; Read-Host "Press Enter to return to menu" | Out-Null }
    "8" { Import-Campaigns-FromFile; Write-Host ""; Read-Host "Press Enter to return to menu" | Out-Null }
    "9" {
      $seedPath = Get-OrCreate-Seed
      $betaDir  = Join-Path $RepoPath "docs\data\beta"
      if (Test-Path $seedPath) { Start-Process notepad.exe $seedPath } else { Log "Seed manifest still not found." }
      if (-not (Test-Path $betaDir)) { New-Item -ItemType Directory -Path $betaDir -Force | Out-Null }
      Start-Process explorer.exe $betaDir
      Write-Host ""; Read-Host "Press Enter to return to menu" | Out-Null
    }
    "10" {
      $c = Read-Host "Congress number (blank=keep $Congress)"
      if ($c -match '^\d+$') { $script:Congress = [int]$c }
      $h = Read-Host "Continuous interval hours (blank=keep $IntervalHours)"
      if ($h -match '^\d+$') { $script:IntervalHours = [int]$h }
      $nf = Read-Host "Run feeds after generation? (y/n, blank=keep)"
      if ($nf -match '^(?i)n$') { $script:NoFeeds = $true } elseif ($nf -match '^(?i)y$') { $script:NoFeeds = $false }
      Write-Host ""; Read-Host "Press Enter to return to menu" | Out-Null
    }
    "11" { return $false }
    default { Write-Host "Invalid choice."; Write-Host ""; Read-Host "Press Enter to return to menu" | Out-Null }
  }
  return $true
}

# ---- Entry point ----
if (-not (Test-Path $RepoPath)) { Write-Error "Repo not found: $RepoPath"; Pause-Exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "node (v18+) is required but not found in PATH."; Pause-Exit 1 }
if (-not (Get-Command git  -ErrorAction SilentlyContinue)) { Write-Error "git is required but not found in PATH."; Pause-Exit 1 }

Log "Repo: $RepoPath | Congress: $Congress"

$hasExplicit = $PSBoundParameters.ContainsKey('Once') -or $PSBoundParameters.ContainsKey('NonInteractive')
if ($hasExplicit -and $NonInteractive) {
  if ($Once) { Run-Cycle -Interactive $false; Pause-Exit 0 }
  else { while ($true) { Run-Cycle -Interactive $false; $sec=[Math]::Max(1,$IntervalHours)*3600; Log "Sleeping $IntervalHours h..."; Start-Sleep -Seconds $sec } }
} elseif ($hasExplicit -and $Once -and -not $NonInteractive) {
  Run-Cycle -Interactive $true; Pause-Exit 0
} else {
  $keep = $true
  while ($keep) { $keep = Show-Menu }
  Pause-Exit 0
}

