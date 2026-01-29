/**
 * Jira Site Handler
 * Detects Jira Server, Data Center, and Cloud instances and handles their unique scroll behavior
 */

const JiraHandler = {
  name: 'Jira',

  /**
   * Detect if the current page is a Jira issue page
   * Works for Server, Data Center, and Cloud
   */
  detect() {
    // Method 1: Jira Cloud - ALWAYS hosted on *.atlassian.net
    // This is the most reliable check for Cloud
    const isJiraCloud = (
      window.location.hostname.endsWith('.atlassian.net') &&
      window.location.pathname.match(/\/browse\/[A-Z]+-\d+/)
    );

    if (isJiraCloud) {
      return { type: 'jira-cloud', detected: true };
    }

    // Method 2: Jira Server/Data Center - self-hosted, detect by DOM
    // These AUI elements are consistent across all Server/DC versions
    const isJiraServer = !!(
      document.getElementById('issue-content') &&
      document.querySelector('.issue-view') &&
      document.querySelector('.aui-page-panel')
    );

    if (isJiraServer) {
      return { type: 'jira-server', detected: true };
    }

    // Method 3: Fallback - check for Jira markers (meta tags, globals)
    // Catches edge cases like proxied instances or unusual setups
    const hasJiraMeta = !!(
      document.querySelector('meta[name="application-name"][content*="JIRA"]') ||
      document.querySelector('meta[name="application-name"][content*="Jira"]') ||
      window.JIRA ||
      window.AJS?.Meta?.get('issue-key')
    );

    if (hasJiraMeta) {
      return { type: 'jira-unknown', detected: true };
    }

    return { detected: false };
  },

  /**
   * Find the scroll container for Jira pages
   */
  findScrollContainer() {
    const detection = this.detect();

    if (!detection.detected) {
      return null;
    }

    if (detection.type === 'jira-server') {
      return this.findServerScrollContainer();
    }

    if (detection.type === 'jira-cloud') {
      return this.findCloudScrollContainer();
    }

    // For unknown Jira type, try both methods
    return this.findServerScrollContainer() || this.findCloudScrollContainer();
  },

  /**
   * Find scroll container for Jira Server/Data Center
   * The .issue-view element has inline height and overflow:auto
   */
  findServerScrollContainer() {
    const issueView = document.querySelector('.issue-view');

    if (!issueView) {
      return null;
    }

    const style = getComputedStyle(issueView);
    const hasOverflow = style.overflowY === 'auto' || style.overflowY === 'scroll';
    const canScroll = issueView.scrollHeight > issueView.clientHeight + 10;

    if (hasOverflow && canScroll) {
      return {
        element: issueView,
        type: 'jira-server',
        scrollHeight: issueView.scrollHeight,
        clientHeight: issueView.clientHeight
      };
    }

    return null;
  },

  /**
   * Find scroll container for Jira Cloud
   * Cloud typically uses a different scroll structure
   */
  findCloudScrollContainer() {
    // Jira Cloud potential scroll containers (may vary by version)
    const selectors = [
      '[data-testid="issue.views.issue-base.foundation.issue-panel"]',
      '[data-testid="issue-view-scrollable-container"]',
      '[data-testid="issue.views.issue-base.foundation.content"]',
      '.css-1dbjc4n[style*="overflow"]', // React Native Web pattern
      '[role="main"]'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);

      for (const el of elements) {
        const style = getComputedStyle(el);
        const hasOverflow = style.overflowY === 'auto' || style.overflowY === 'scroll';
        const canScroll = el.scrollHeight > el.clientHeight + 10;

        if (hasOverflow && canScroll) {
          return {
            element: el,
            type: 'jira-cloud',
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight
          };
        }
      }
    }

    // Fallback: find largest scrollable element
    return this.findLargestScrollableElement();
  },

  /**
   * Fallback: find the largest scrollable element on the page
   * Useful when specific selectors don't match
   */
  findLargestScrollableElement() {
    let bestMatch = null;
    let bestScrollHeight = 0;

    const allElements = document.querySelectorAll('*');

    for (const el of allElements) {
      // Skip tiny elements
      if (el.offsetWidth < 200 || el.offsetHeight < 200) continue;

      const style = getComputedStyle(el);
      const hasOverflow = style.overflowY === 'auto' || style.overflowY === 'scroll';
      const canScroll = el.scrollHeight > el.clientHeight + 50;

      if (hasOverflow && canScroll && el.scrollHeight > bestScrollHeight) {
        bestScrollHeight = el.scrollHeight;
        bestMatch = el;
      }
    }

    if (bestMatch) {
      return {
        element: bestMatch,
        type: 'jira-fallback',
        scrollHeight: bestMatch.scrollHeight,
        clientHeight: bestMatch.clientHeight
      };
    }

    return null;
  },

  /**
   * Get the center content bounds for Jira pages (for center-only capture)
   */
  getCenterBounds() {
    const detection = this.detect();

    if (detection.type === 'jira-server') {
      return this.getServerCenterBounds();
    }

    if (detection.type === 'jira-cloud') {
      return this.getCloudCenterBounds();
    }

    return null;
  },

  /**
   * Get center bounds for Jira Server/Data Center
   */
  getServerCenterBounds() {
    const leftSidebar = document.querySelector('.aui-sidebar');
    const rightSidebar = document.getElementById('viewissuesidebar');
    const issueView = document.querySelector('.issue-view');

    if (!issueView) return null;

    const viewRect = issueView.getBoundingClientRect();
    const leftBound = leftSidebar ? leftSidebar.getBoundingClientRect().right : 0;
    const rightBound = rightSidebar ? rightSidebar.getBoundingClientRect().left : viewRect.right;

    return {
      left: Math.round(leftBound),
      right: Math.round(rightBound),
      top: Math.round(viewRect.top),
      width: Math.round(rightBound - leftBound),
      scrollHeight: issueView.scrollHeight,
      clientHeight: issueView.clientHeight
    };
  },

  /**
   * Get center bounds for Jira Cloud
   */
  getCloudCenterBounds() {
    // Cloud layout detection - this may need adjustment as Cloud UI evolves
    const mainContent = document.querySelector('[data-testid="issue.views.issue-base.foundation.content"]') ||
                        document.querySelector('[role="main"]');

    if (!mainContent) return null;

    const rect = mainContent.getBoundingClientRect();

    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      scrollHeight: mainContent.scrollHeight,
      clientHeight: mainContent.clientHeight
    };
  }
};

// Export for use in contentScript.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JiraHandler;
}
