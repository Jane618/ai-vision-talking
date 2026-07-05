(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // --- Chart: Radar ---
  var chartRadar = echarts.init(document.getElementById('chart-radar'), null, { renderer: 'svg' });
  chartRadar.setOption({
    animation: false,
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      backgroundColor: bg2,
      borderColor: rule,
      textStyle: { color: ink }
    },
    legend: {
      data: ['React + Go', 'React + Python', 'Vue + Go', 'Vue + Python'],
      bottom: 0,
      textStyle: { color: muted }
    },
    radar: {
      indicator: [
        { name: '并发性能', max: 10 },
        { name: 'AI 生态', max: 10 },
        { name: '开发效率', max: 10 },
        { name: '类型安全', max: 10 },
        { name: '部署效率', max: 10 },
        { name: '招人难度', max: 10 }
      ],
      shape: 'polygon',
      splitNumber: 5,
      axisName: {
        color: ink,
        fontSize: 13
      },
      splitLine: {
        lineStyle: { color: rule }
      },
      splitArea: {
        areaStyle: {
          color: [bg2, 'transparent']
        }
      },
      axisLine: {
        lineStyle: { color: rule }
      }
    },
    series: [{
      type: 'radar',
      data: [
        {
          value: [9.5, 5.5, 6, 9, 9.5, 6],
          name: 'React + Go',
          lineStyle: { color: accent, width: 2 },
          areaStyle: { color: accent + '33' },
          itemStyle: { color: accent }
        },
        {
          value: [7, 9.5, 8, 6, 5, 8.5],
          name: 'React + Python',
          lineStyle: { color: accent2, width: 2 },
          areaStyle: { color: accent2 + '33' },
          itemStyle: { color: accent2 }
        },
        {
          value: [9.5, 5.5, 7.5, 9, 9.5, 6],
          name: 'Vue + Go',
          lineStyle: { color: '#4ade80', width: 2 },
          areaStyle: { color: '#4ade8033' },
          itemStyle: { color: '#4ade80' }
        },
        {
          value: [7, 9.5, 9, 5.5, 5, 8.5],
          name: 'Vue + Python',
          lineStyle: { color: '#f87171', width: 2 },
          areaStyle: { color: '#f8717133' },
          itemStyle: { color: '#f87171' }
        }
      ]
    }]
  });
  window.addEventListener('resize', function() { chartRadar.resize(); });
})();
