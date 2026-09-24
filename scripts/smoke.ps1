<#
.SYNOPSIS
  End-to-end smoke test against a running API (default http://localhost:3000).
  Exercises: OTP login -> profile (age check) -> feed -> server-timed watch session -> completion (+ idempotent replay)
  -> balance -> two-step admin coin adjustment -> withdrawal request (held for review) -> finance approval -> payout worker.

.EXAMPLE
  pnpm smoke
  powershell -ExecutionPolicy Bypass -File scripts/smoke.ps1 -BaseUrl http://localhost:3000
#>
param(
  [string]$BaseUrl = 'http://localhost:3000',
  [string]$AdminPassword = 'Admin123!',
  [int]$PayoutWaitSeconds = 60
)

$ErrorActionPreference = 'Stop'
$api = "$BaseUrl/api/v1"
$script:step = 0

function Step([string]$msg) { $script:step++; Write-Host ("`n[{0,2}] {1}" -f $script:step, $msg) -ForegroundColor Cyan }
function Ok([string]$msg) { Write-Host "     OK  $msg" -ForegroundColor Green }
function Fail([string]$msg) { Write-Host "     FAIL $msg" -ForegroundColor Red; exit 1 }
function Assert($cond, [string]$msg) { if (-not $cond) { Fail $msg } else { Ok $msg } }

function Call([string]$Method, [string]$Path, $Body = $null, [string]$Token = $null, [switch]$AllowError) {
  $headers = @{ 'Content-Type' = 'application/json' }
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  $params = @{ Method = $Method; Uri = "$api$Path"; Headers = $headers; UseBasicParsing = $true }
  if ($null -ne $Body) { $params['Body'] = ($Body | ConvertTo-Json -Depth 8 -Compress) }
  try {
    $res = Invoke-WebRequest @params
    if ([string]::IsNullOrWhiteSpace($res.Content)) { return $null }
    return $res.Content | ConvertFrom-Json
  } catch {
    $resp = $_.Exception.Response
    $bodyText = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $bodyText = $_.ErrorDetails.Message
    } elseif ($resp) {
      try {
        $stream = $resp.GetResponseStream()
        if ($stream.CanSeek) { $stream.Position = 0 }
        $reader = New-Object System.IO.StreamReader($stream)
        $bodyText = $reader.ReadToEnd()
      } catch { $bodyText = '' }
    }
    if ($AllowError) {
      if ($bodyText) { try { return ($bodyText | ConvertFrom-Json) } catch { } }
      return @{ statusCode = [int]$resp.StatusCode; code = 'HTTP_ERROR'; message = $bodyText }
    }
    Fail "$Method $Path -> $(if ($resp) { [int]$resp.StatusCode }) $bodyText $($_.Exception.Message)"
  }
}

Step "Health checks"
$health = Invoke-RestMethod "$BaseUrl/health"
Assert ($health.status -eq 'ok') "liveness: $($health.status) v$($health.version)"
$ready = Invoke-RestMethod "$BaseUrl/health/ready"
Assert ($ready.status -eq 'ready') "readiness: db=$($ready.checks.database) redis=$($ready.checks.redis)"

Step "OTP request for a fresh phone number"
$phone = '+2519' + (Get-Random -Minimum 10000000 -Maximum 99999999)
$otp = Call POST '/auth/otp/request' @{ phoneNumber = $phone }
Assert ($otp.phoneNumber -eq $phone) "normalised phone $($otp.phoneNumber), expires in $($otp.expiresInSeconds)s"
if (-not $otp.devCode) { Fail 'OTP_DEV_ECHO must be true for the smoke test (devCode missing)' }

Step "OTP verify (creates user)"
$fp = 'fp_smoke_' + (Get-Random)
$verify = Call POST '/auth/otp/verify' @{ phoneNumber = $phone; code = $otp.devCode; deviceId = 'smoke-device'; deviceFingerprint = $fp }
$userToken = $verify.tokens.accessToken
Assert ($verify.isNewUser -eq $true -and $userToken) "new user $($verify.user.id), profileComplete=$($verify.user.profileComplete)"

Step "Age gate: under-18 date of birth must be rejected with AGE_RESTRICTED"
$minor = Call POST '/auth/otp/request' @{ phoneNumber = ('+2517' + (Get-Random -Minimum 10000000 -Maximum 99999999)) }
$minorVerify = Call POST '/auth/otp/verify' @{ phoneNumber = $minor.phoneNumber; code = $minor.devCode }
$minorDob = (Get-Date).AddYears(-16).ToString('yyyy-MM-dd')
$ageErr = Call POST '/auth/users/complete-profile' @{ fullName = 'Test Minor'; dateOfBirth = $minorDob } $minorVerify.tokens.accessToken -AllowError
Assert ($ageErr.code -eq 'AGE_RESTRICTED' -and $ageErr.statusCode -eq 403) "minor blocked: $($ageErr.code)"

Step "Complete adult profile"
$profile = Call POST '/auth/users/complete-profile' @{ fullName = 'Smoke Tester (ሙከራ)'; dateOfBirth = '1992-05-14'; languagePreference = 'am' } $userToken
Assert ($profile.ageVerificationStatus -eq 'verified_adult' -and $profile.profileComplete) "verified_adult, language=$($profile.languagePreference)"

Step "Ad feed"
$feed = Call GET '/ads/feed?limit=20' $null $userToken
Assert ($feed.data.Count -gt 0) "$($feed.data.Count) ads available (daily $($feed.meta.dailyCompleted)/$($feed.meta.dailyLimit))"
$ad = $feed.data | Sort-Object durationSeconds | Select-Object -First 1
Ok "picked '$($ad.title)' ($($ad.durationSeconds)s, reward $($ad.rewardCoins) coins, attention=$($ad.hasAttentionCheck))"

Step "Start watch session"
$session = Call POST "/ads/$($ad.id)/watch-sessions" @{ deviceFingerprint = $fp; deviceId = 'smoke-device' } $userToken
Assert ($session.sessionId) "session $($session.sessionId): minWatch=$($session.minWatchSeconds)s heartbeat every $($session.heartbeatIntervalSeconds)s"

Step "Look up the correct attention answer through the admin API (reviewer role)"
$answerIndex = $null
if ($session.attentionQuestion) {
  $reviewer = Call POST '/auth/admin/login' @{ email = 'reviewer@rap.et'; password = $AdminPassword }
  $adminAd = Call GET "/admin/ads/$($ad.id)" $null $reviewer.tokens.accessToken
  $q = $adminAd.attentionQuestions | Where-Object { $_.id -eq $session.attentionQuestion.id }
  $answerIndex = $q.correctIndex
  Ok "question '$($session.attentionQuestion.prompt)' -> option #$answerIndex"
} else { Ok 'no attention question for this ad' }

Step "Premature completion must be rejected (WATCH_DURATION_INSUFFICIENT) - using a second session"
# a second session for the same ad is allowed (retry budget) - the first one is abandoned by the server
$early = Call POST "/ads/$($ad.id)/watch-sessions" @{ deviceFingerprint = $fp } $userToken
$earlyBody = @{}
if ($null -ne $answerIndex) { $earlyBody['attentionAnswerIndex'] = $answerIndex }
$earlyResult = Call POST "/ads/watch-sessions/$($early.sessionId)/complete" $earlyBody $userToken
Assert ($earlyResult.status -eq 'rejected' -and $earlyResult.reasonCode -eq 'WATCH_DURATION_INSUFFICIENT') "rejected with $($earlyResult.reasonCode), coins=$($earlyResult.coinReward)"

Step "Watch properly: heartbeats until the server-side minimum elapses"
$session = Call POST "/ads/$($ad.id)/watch-sessions" @{ deviceFingerprint = $fp } $userToken
$interval = [int]$session.heartbeatIntervalSeconds
$elapsed = 0
while ($elapsed -lt ($session.minWatchSeconds + 1)) {
  Start-Sleep -Seconds $interval
  $elapsed += $interval
  $hb = Call POST "/ads/watch-sessions/$($session.sessionId)/heartbeat" @{ positionSeconds = $elapsed } $userToken
  Write-Host "     heartbeat #$($hb.heartbeatCount) at $($hb.elapsedSeconds)s"
}

Step "Complete the watch session"
$body = @{}
if ($null -ne $answerIndex) { $body['attentionAnswerIndex'] = $answerIndex }
$result = Call POST "/ads/watch-sessions/$($session.sessionId)/complete" $body $userToken
Assert ($result.status -in @('valid', 'flagged')) "status=$($result.status) coins=$($result.coinReward) watched=$($result.watchDurationSeconds)s flags=[$($result.fraudFlags -join ',')]"

Step "Idempotent replay never double-credits"
$replay = Call POST "/ads/watch-sessions/$($session.sessionId)/complete" $body $userToken
Assert ($replay.replayed -eq $true -and $replay.completionId -eq $result.completionId) "replayed=true, same completion $($replay.completionId)"

Step "Balance from the ledger"
$balance = Call GET '/users/me/balance' $null $userToken
$expected = if ($result.status -eq 'valid') { $ad.rewardCoins } else { 0 }
Assert ($balance.coinBalance -eq $expected -and $balance.ledgerChecksum.consistent) "coinBalance=$($balance.coinBalance) (= $($balance.etbEquivalent) ETB), ledger consistent"

Step "Two-step coin adjustment: finance requests, a different admin approves"
$finance = Call POST '/auth/admin/login' @{ email = 'finance@rap.et'; password = $AdminPassword }
$superAdmin = Call POST '/auth/admin/login' @{ email = 'super@rap.et'; password = $AdminPassword }
$adj = Call POST '/admin/coin-adjustments' @{ userId = $verify.user.id; amount = 6000; reason = 'Smoke test: seed balance for withdrawal flow'; reference = 'SMOKE' } $finance.tokens.accessToken
Assert ($adj.status -eq 'pending_approval') "request $($adj.id) pending approval"
$self = Call POST "/admin/coin-adjustments/$($adj.id)/approve" @{ note = 'self' } $finance.tokens.accessToken -AllowError
Assert ($self.code -eq 'ADJUSTMENT_SELF_APPROVAL_FORBIDDEN') "self-approval blocked: $($self.code)"
$approved = Call POST "/admin/coin-adjustments/$($adj.id)/approve" @{ note = 'Approved for smoke test' } $superAdmin.tokens.accessToken
Assert ($approved.status -eq 'executed' -and $approved.ledgerEntryId) "executed by second admin, ledger entry $($approved.ledgerEntryId)"
$balance2 = Call GET '/users/me/balance' $null $userToken
Assert ($balance2.coinBalance -eq ($expected + 6000)) "balance now $($balance2.coinBalance) coins"

Step "Withdrawal config + request (first-ever -> held for review)"
$cfg = Call GET '/withdrawals/config' $null $userToken
Ok "min $($cfg.minWithdrawalEtb) ETB, $($cfg.coinsPerEtb) coins/ETB, methods: $(($cfg.methods | Where-Object available | ForEach-Object method) -join ', ')"
$tooSmall = Call POST '/withdrawals' @{ amountEtb = 10; payoutMethod = 'telebirr'; payoutDestination = $phone } $userToken -AllowError
Assert ($tooSmall.code -eq 'BELOW_MIN_WITHDRAWAL') "10 ETB rejected: $($tooSmall.code)"
$wd = Call POST '/withdrawals' @{ amountEtb = 50; payoutMethod = 'telebirr'; payoutDestination = $phone } $userToken
Assert ($wd.status -eq 'flagged_for_review' -and ($wd.reviewReasons -contains 'first_withdrawal')) "withdrawal $($wd.id) held: [$($wd.reviewReasons -join ',')]"
$balance3 = Call GET '/users/me/balance' $null $userToken
Assert ($balance3.coinBalance -eq ($expected + 6000 - 5000)) "coins held immediately: balance $($balance3.coinBalance)"

Step "Finance approves the held withdrawal -> queued for payout"
$approvedWd = Call POST "/admin/withdrawals/$($wd.id)/approve" @{ note = 'KYC ok (smoke)' } $finance.tokens.accessToken
Assert ($approvedWd.status -in @('pending', 'processing', 'completed', 'failed')) "status after approval: $($approvedWd.status)"

Step "Payout worker (mock provider) moves pending -> processing -> completed|failed"
$final = $null
$deadline = (Get-Date).AddSeconds($PayoutWaitSeconds)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  $w = Call GET "/withdrawals/$($wd.id)" $null $userToken
  Write-Host "     status=$($w.status) provider=$($w.providerName)"
  if ($w.status -in @('completed', 'failed')) { $final = $w; break }
}
if (-not $final) { Fail "payout did not reach a final state within $PayoutWaitSeconds s (is QUEUES_ENABLED=true and redis running?)" }
Ok "final status $($final.status) via $($final.providerName) ($($final.providerPayoutId))"
$balance4 = Call GET '/users/me/balance' $null $userToken
if ($final.status -eq 'failed') {
  Assert ($balance4.coinBalance -eq ($expected + 6000)) "failed payout refunded the hold: balance $($balance4.coinBalance)"
} else {
  Assert ($balance4.coinBalance -eq ($expected + 6000 - 5000)) "completed payout: balance $($balance4.coinBalance)"
}
Assert ($balance4.ledgerChecksum.consistent) "ledger checksum consistent ($($balance4.ledgerChecksum.entries) entries)"

Step "Ledger history and audit trail"
$ledger = Call GET '/users/me/ledger?limit=10' $null $userToken
Ok "ledger entries: $(($ledger.data | ForEach-Object { "$($_.sourceType):$($_.amount)" }) -join ' ')"
$audit = Call GET "/admin/audit-log?targetId=$($wd.id)" $null $superAdmin.tokens.accessToken
Assert ($audit.meta.total -ge 2) "$($audit.meta.total) audit rows for the withdrawal: $(($audit.data | ForEach-Object action) -join ', ')"

Write-Host "`nSMOKE TEST PASSED" -ForegroundColor Green
