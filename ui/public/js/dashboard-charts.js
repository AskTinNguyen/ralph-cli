/**
 * Dashboard Charts
 *
 * Initializes and manages Chart.js charts for the dashboard trends section.
 * Handles period selection and chart updates.
 */

(function() {
  'use strict';

  // Chart instances
  let costChart = null;
  let velocityChart = null;
  let successChart = null;

  // Current periods
  let currentPeriods = {
    cost: '7d',
    velocity: '7d',
    success: '7d'
  };

  // Chart.js default configuration
  const defaultChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: 12,
        titleFont: {
          size: 14,
          weight: 'bold'
        },
        bodyFont: {
          size: 13
        },
        cornerRadius: 4
      }
    },
    scales: {
      x: {
        grid: {
          display: false
        },
        ticks: {
          font: {
            size: 11
          }
        }
      },
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        },
        ticks: {
          font: {
            size: 11
          }
        }
      }
    }
  };

  /**
   * Initialize cost chart
   */
  async function initCostChart() {
    const ctx = document.getElementById('cost-chart');
    if (!ctx) return;

    try {
      const response = await fetch(`/api/trends/cost?period=${currentPeriods.cost}`);
      const result = await response.json();
      const data = result.chartData || {};

      if (costChart) {
        costChart.destroy();
      }

      costChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.labels || [],
          datasets: data.datasets ? [{
            label: data.datasets[0].label,
            data: data.datasets[0].data || [],
            borderColor: '#1A4D2E',
            backgroundColor: 'rgba(26, 77, 46, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.3
          }] : []
        },
        options: {
          ...defaultChartOptions,
          scales: {
            ...defaultChartOptions.scales,
            y: {
              ...defaultChartOptions.scales.y,
              ticks: {
                ...defaultChartOptions.scales.y.ticks,
                callback: function(value) {
                  return '$' + value.toFixed(2);
                }
              }
            }
          },
          plugins: {
            ...defaultChartOptions.plugins,
            tooltip: {
              ...defaultChartOptions.plugins.tooltip,
              callbacks: {
                label: function(context) {
                  return 'Cost: $' + context.parsed.y.toFixed(2);
                }
              }
            }
          }
        }
      });

      // Hide skeleton loader once chart is initialized
      const skeleton = document.getElementById('cost-chart-skeleton');
      if (skeleton) {
        skeleton.classList.add('hidden');
        setTimeout(() => skeleton.style.display = 'none', 200);
      }
    } catch (error) {
      console.error('[Dashboard Charts] Failed to load cost chart:', error);
    }
  }

  /**
   * Initialize velocity chart
   */
  async function initVelocityChart() {
    const ctx = document.getElementById('velocity-chart');
    if (!ctx) return;

    try {
      const response = await fetch(`/api/trends/velocity?period=${currentPeriods.velocity}`);
      const result = await response.json();
      const data = result.chartData || {};

      if (velocityChart) {
        velocityChart.destroy();
      }

      velocityChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.labels || [],
          datasets: data.datasets ? [{
            label: 'Stories Completed',
            data: data.datasets[0].data || [],
            backgroundColor: '#52B788',
            borderColor: '#2D6A4F',
            borderWidth: 1
          }] : []
        },
        options: {
          ...defaultChartOptions,
          plugins: {
            ...defaultChartOptions.plugins,
            tooltip: {
              ...defaultChartOptions.plugins.tooltip,
              callbacks: {
                label: function(context) {
                  return 'Stories: ' + context.parsed.y;
                }
              }
            }
          }
        }
      });

      // Hide skeleton loader once chart is initialized
      const skeleton = document.getElementById('velocity-chart-skeleton');
      if (skeleton) {
        skeleton.classList.add('hidden');
        setTimeout(() => skeleton.style.display = 'none', 200);
      }
    } catch (error) {
      console.error('[Dashboard Charts] Failed to load velocity chart:', error);
    }
  }

  /**
   * Initialize success rate chart
   */
  async function initSuccessChart() {
    const ctx = document.getElementById('success-chart');
    if (!ctx) return;

    try {
      const response = await fetch(`/api/trends/success-rate?period=${currentPeriods.success}`);
      const result = await response.json();
      const data = result.chartData || {};

      if (successChart) {
        successChart.destroy();
      }

      successChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.labels || [],
          datasets: data.datasets ? [{
            label: 'Success Rate',
            data: data.datasets[0].data || [],
            borderColor: '#10B981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.3
          }] : []
        },
        options: {
          ...defaultChartOptions,
          scales: {
            ...defaultChartOptions.scales,
            y: {
              ...defaultChartOptions.scales.y,
              min: 0,
              max: 100,
              ticks: {
                ...defaultChartOptions.scales.y.ticks,
                callback: function(value) {
                  return value + '%';
                }
              }
            }
          },
          plugins: {
            ...defaultChartOptions.plugins,
            tooltip: {
              ...defaultChartOptions.plugins.tooltip,
              callbacks: {
                label: function(context) {
                  return 'Success Rate: ' + context.parsed.y.toFixed(1) + '%';
                }
              }
            }
          }
        }
      });

      // Hide skeleton loader once chart is initialized
      const skeleton = document.getElementById('success-chart-skeleton');
      if (skeleton) {
        skeleton.classList.add('hidden');
        setTimeout(() => skeleton.style.display = 'none', 200);
      }
    } catch (error) {
      console.error('[Dashboard Charts] Failed to load success rate chart:', error);
    }
  }

  /**
   * Handle period button clicks
   */
  function initPeriodSelectors() {
    const buttons = document.querySelectorAll('.chart-period-btn');

    buttons.forEach(button => {
      button.addEventListener('click', function() {
        const chartType = this.getAttribute('data-chart');
        const period = this.getAttribute('data-period');

        // Update active state for this chart's buttons
        const siblingButtons = this.parentElement.querySelectorAll('.chart-period-btn');
        siblingButtons.forEach(btn => btn.classList.remove('active'));
        this.classList.add('active');

        // Update period and reload chart
        currentPeriods[chartType] = period;

        switch(chartType) {
          case 'cost':
            initCostChart();
            break;
          case 'velocity':
            initVelocityChart();
            break;
          case 'success':
            initSuccessChart();
            break;
        }
      });
    });
  }

  /**
   * Initialize all charts
   */
  function initDashboardCharts() {
    // Wait for Chart.js to be available
    if (typeof Chart === 'undefined') {
      console.error('[Dashboard Charts] Chart.js not loaded');
      return;
    }

    initCostChart();
    initVelocityChart();
    initSuccessChart();
    initPeriodSelectors();
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboardCharts);
  } else {
    initDashboardCharts();
  }

  // Re-initialize on HTMX after-swap (if charts section was replaced)
  document.body.addEventListener('htmx:afterSwap', function(event) {
    if (event.detail.target && event.detail.target.querySelector('.chart-canvas')) {
      setTimeout(initDashboardCharts, 100);
    }
  });

})();
