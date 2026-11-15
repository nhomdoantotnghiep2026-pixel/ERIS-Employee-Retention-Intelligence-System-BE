param([string]$Archive=(Join-Path $env:USERPROFILE 'Downloads\eris-ai-service.zip'))
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$runtime=Join-Path $repoRoot '.local\ai-service'
$envPath=Join-Path $repoRoot '.env'
if(-not (Test-Path -LiteralPath $envPath)){throw 'Backend .env is missing.'}
$keyLine=Get-Content -LiteralPath $envPath | Where-Object {$_ -match '^AI_SERVICE_KEY='} | Select-Object -Last 1
if(-not $keyLine){throw 'Add AI_SERVICE_KEY (at least 24 characters) to backend .env first.'}
$key=$keyLine.Substring('AI_SERVICE_KEY='.Length).Trim().Trim('"').Trim("'")
if($key.Length -lt 24 -or $key -match '[\r\n]'){throw 'Invalid AI_SERVICE_KEY.'}
if(-not (Test-Path -LiteralPath (Join-Path $runtime 'artifacts\mexwell_rf12_demo_v1\bundle.joblib'))){
 if(-not (Test-Path -LiteralPath $Archive)){throw 'Model ZIP not found. Supply -Archive with its path.'}
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 [IO.Directory]::CreateDirectory($runtime)|Out-Null
 $zip=[IO.Compression.ZipFile]::OpenRead($Archive)
 try{foreach($entry in $zip.Entries){
  $relative=$entry.FullName -replace '^eris-ai-service/',''
  if($relative -match '^src/eris_ai/[^/]+\.py$' -or $relative -in @('requirements-lock.txt','artifacts/mexwell_rf12_demo_v1/bundle.joblib')){
   $target=[IO.Path]::GetFullPath((Join-Path $runtime $relative))
   if(-not $target.StartsWith($runtime+[IO.Path]::DirectorySeparatorChar)){throw 'Invalid ZIP path.'}
   [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))|Out-Null
   [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)
  }
 }}finally{$zip.Dispose()}
}
$envFile=Join-Path $repoRoot '.local\ai-service.env'
[IO.File]::WriteAllText($envFile,"ERIS_SERVICE_KEY=$key`nERIS_MEXWELL_DEMO_ENABLED=true`nERIS_MEXWELL_DEMO_BUNDLE=/app/artifacts/mexwell_rf12_demo_v1/bundle.joblib`n",[Text.UTF8Encoding]::new($false))
& docker build -f (Join-Path $PSScriptRoot 'Dockerfile') -t eris-ai-mexwell-demo:local $runtime
if($LASTEXITCODE -ne 0){throw 'AI image build failed.'}
$existing=& docker ps -a --filter 'name=^/eris-ai-mexwell$' --format '{{.ID}}'
if($existing){
 $labelsJson=& docker inspect --format '{{json .Config.Labels}}' eris-ai-mexwell
 if($LASTEXITCODE -ne 0){throw 'Could not inspect existing AI container.'}
 $labels=$labelsJson | ConvertFrom-Json
 if($labels.'com.eris.component' -ne 'ai-mexwell-demo'){throw 'Container eris-ai-mexwell is not managed by this script.'}
 & docker rm -f eris-ai-mexwell | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Could not restart managed AI container.'}
}
& docker run -d --name eris-ai-mexwell --label com.eris.component=ai-mexwell-demo --restart unless-stopped --read-only --tmpfs /tmp:rw,noexec,nosuid,size=128m --cap-drop ALL --security-opt no-new-privileges --memory 1g --cpus 2 -p 127.0.0.1:8000:8000 --env-file $envFile eris-ai-mexwell-demo:local
if($LASTEXITCODE -ne 0){throw 'Could not start AI container. Check whether port 8000 is already in use.'}
$ready=$false
for($i=0;$i -lt 30;$i++){
 try{$null=Invoke-RestMethod 'http://127.0.0.1:8000/ready' -Headers @{'X-ERIS-Service-Key'=$key};$ready=$true;break}catch{Start-Sleep -Milliseconds 500}
}
if(-not $ready){throw 'AI container started but model is not ready. Check docker logs eris-ai-mexwell.'}
Write-Output 'AI ready at http://127.0.0.1:8000 (demo model). Backend: /api/ai/model; screen: /ai-demo.'
