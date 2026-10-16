import {monitorEventLoopDelay} from 'node:perf_hooks';
import {metrics} from './metrics.mjs';
import {runtimeLog} from './logger.mjs';
import {detectStaleAttempts} from './dependencies.mjs';
import {createMetricIntervals} from './metric-intervals.mjs';
export function startRuntimeMetrics(pool,{log=runtimeLog,intervalMs=60000}={}){
 const delay=monitorEventLoopDelay({resolution:20});delay.enable();
 const intervals=createMetricIntervals(log.metadata||runtimeLog.metadata);let previousDrops=0;
 const tick=()=>{
  const memory=process.memoryUsage(),queue=log.stats?.()||{};
  const values={rssBytes:memory.rss,heapBytes:memory.heapUsed,eventLoopDelayMs:Number.isFinite(delay.mean)?delay.mean/1e6:0,poolTotal:pool?.totalCount||0,poolIdle:pool?.idleCount||0,poolWaiting:pool?.waitingCount||0,queueDepth:queue.pending||0,queueDropped:queue.dropped||0};
  for(const [key,value] of Object.entries(values))metrics.gauge(key,value);
  const exporter=log.exporterStats?.();if(exporter){values.exportDropped=exporter.dropped;values.exportPending=exporter.pending;if(exporter.dropped>previousDrops)log({event:'telemetry.gap',reason:'export_loss',sourceCount:exporter.dropped-previousDrops});previousDrops=exporter.dropped;}
  log({event:'runtime.health.observed',...values});log({event:'telemetry.canary'});
  for(const frame of intervals(metrics.snapshot()))log.exportMetric?.(frame);
  detectStaleAttempts();delay.reset();
 };
 let timer;const first=setTimeout(()=>{tick();timer=setInterval(tick,intervalMs);timer.unref();},intervalMs===60000?60000-Date.now()%60000:intervalMs);first.unref();return ()=>{clearTimeout(first);clearInterval(timer);delay.disable();};
}
