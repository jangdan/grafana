import { css } from '@emotion/css';
import html2canvas from 'html2canvas';
import { useCallback, useEffect, useState, DragEvent, useRef } from 'react';
import SVG from 'react-inlinesvg';
import Markdown from 'react-markdown';

import { openai } from '@grafana/llm';
import { Button, CustomScrollbar, Toggletip } from '@grafana/ui';

import grot from './grot.svg';

export const Hoverbot = () => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [reply, setReply] = useState('');
  const [[x, y], setPosition] = useState([
    Number(sessionStorage.getItem('hoverbot.x')) || 0,
    Number(sessionStorage.getItem('hoverbot.y')) || 0,
  ]);
  const posRef = useRef({ x: 0, y: 0 });
  const oldPosRef = useRef({ x, y });
  const lastImageRef = useRef('');
  const lastElementRef = useRef<HTMLDivElement | undefined>(undefined);

  useEffect(() => {
    openai.enabled().then(setEnabled);
  }, []);

  const ask = useCallback((image: string, element: HTMLDivElement, promptSuffix = '') => {
    lastImageRef.current = image;
    lastElementRef.current = element;

    const stream = openai
      .streamChatCompletions({
        model: openai.Model.LARGE,
        messages: [
          { role: 'system', content: 'You are helping an observability user understand the data they are seeing.' },
          {
            role: 'user',
            // @ts-expect-error
            content: [
              {
                type: 'text',
                text: scrapContext(element, promptSuffix),
              },
              {
                type: 'image_url',
                image_url: {
                  url: image,
                },
              },
            ],
          },
        ],
      })
      .pipe(openai.accumulateContent());
    // Subscribe to the stream and update the state for each returned value.
    stream.subscribe({
      next: setReply,
      complete: () => {
        setLoading(false);
      },
      error: (e) => {
        console.error(e);
        setLoading(false);
      },
    });
  }, []);

  const helpMe = useCallback(
    (element: HTMLDivElement) => {
      if (!enabled) {
        console.error('LLM Disabled');
        return;
      }

      setLoading(true);

      html2canvas(element, { allowTaint: true }).then((canvas) => {
        //ask(canvas.toDataURL('image/png', 0.5), element);
        canvas.toBlob((blob) => {
          if (!blob) {
            console.error('Failed to generate canvas blob');
            return;
          }
          upload(blob)
            .then((url) => ask(url, element))
            .catch(console.error);
        });
      });
    },
    [ask, enabled]
  );

  const handleClick = useCallback(() => {
    if (!highlighted) {
      return;
    }
    document.removeEventListener('mouseover', handleMouseOver);
    document.removeEventListener('click', handleClick);
    if (highlighted) {
      highlighted.style.outline = '';
      highlighted.style.boxShadow = '';
      helpMe(highlighted);
      highlighted = undefined;
    }
    setSelecting(false);
  }, [helpMe]);

  const selectRegion = useCallback(() => {
    setSelecting(true);
    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('click', handleClick);
  }, [handleClick]);

  const cancel = useCallback(() => {
    document.removeEventListener('mouseover', handleMouseOver);
    document.removeEventListener('click', handleClick);
    setSelecting(false);
    if (highlighted) {
      highlighted.style.outline = '';
      highlighted.style.boxShadow = '';
      highlighted = undefined;
    }
  }, [handleClick]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        cancel();
      }
    }

    document.addEventListener('keyup', handleEscape);
    return () => document.removeEventListener('keyup', handleEscape);
  }, [cancel, handleClick]);

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      cancel();

      oldPosRef.current.x = x;
      oldPosRef.current.y = y;
      if (event.target instanceof Element) {
        posRef.current.x = event.clientX;
        posRef.current.y = event.clientY;
      }
    },
    [cancel, x, y]
  );

  const handleDrag = useCallback((event: DragEvent<HTMLDivElement>) => {
    const newX = event.clientX - posRef.current.x;
    const newY = posRef.current.y - event.clientY;

    setPosition([oldPosRef.current.x + newX, oldPosRef.current.y + newY]);
  }, []);

  const handleDragEnd = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    const newX = oldPosRef.current.x + (event.clientX - posRef.current.x);
    const newY = oldPosRef.current.y + (posRef.current.y - event.clientY);

    setPosition([newX, newY]);

    if (newX < 0 || newY < 0) {
      console.warn('Disabling hoverbot');
      setEnabled(false);
    } else {
      sessionStorage.setItem('hoverbot.x', newX.toString());
      sessionStorage.setItem('hoverbot.y', newY.toString());
    }
  }, []);

  const regenerate = useCallback(
    (getSuffix: () => string) => {
      if (lastImageRef.current && lastElementRef.current) {
        setReply('');
        setLoading(true);
        ask(lastImageRef.current, lastElementRef.current, getSuffix());
      }
    },
    [ask]
  );

  if (!enabled) {
    console.warn('Hoverbot disabled');
    return null;
  }

  if (loading || selecting || reply) {
    return (
      <div className={styles.grotContainer} style={{ bottom: y, left: x }}>
        <Toggletip
          closeButton={!loading}
          content={
            <CustomScrollbar autoHeightMax="500px">
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
              <div tabIndex={0} className={styles.grotWrapper}>
                {selecting && <p>Click on an element in the screen to get assistance.</p>}
                {loading && <p>Asking Grot...</p>}
                {reply !== '' && <Markdown>{reply}</Markdown>}
                {reply !== '' && (
                  <div className={styles.actions}>
                    <Button
                      variant="secondary"
                      fill="outline"
                      size="sm"
                      disabled={loading}
                      onClick={() => regenerate(getShorterSuffix)}
                    >
                      Shorter
                    </Button>
                    <Button
                      variant="secondary"
                      fill="outline"
                      size="sm"
                      disabled={loading}
                      onClick={() => regenerate(getSimplerSuffix)}
                    >
                      Simpler
                    </Button>
                    <Button
                      variant="secondary"
                      fill="outline"
                      size="sm"
                      disabled={loading}
                      onClick={() => regenerate(getExtraSuffix)}
                    >
                      More details
                    </Button>
                    <Button
                      variant="secondary"
                      fill="outline"
                      size="sm"
                      disabled={loading}
                      onClick={() => regenerate(getNextStepsSuffix)}
                    >
                      Next steps
                    </Button>
                  </div>
                )}
              </div>
            </CustomScrollbar>
          }
          onClose={
            !loading
              ? () => {
                  setReply('');
                  setLoading(false);
                  cancel();
                }
              : undefined
          }
          show={true}
        >
          <button className={`${styles.invisibleButton} ${subtleMove}`}>
            <SVG src={grot} width={250} height={250} />
          </button>
        </Toggletip>
      </div>
    );
  }

  return (
    <div
      className={`${styles.grotContainer} ${subtleMove}`}
      style={{ bottom: y, left: x }}
      draggable="true"
      onDrag={handleDrag}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SVG src={grot} width={250} height={250} onClick={selectRegion} />
    </div>
  );
};

const subtleMove = css`
  @keyframes subtleMove {
    0% {
      transform: translateY(0) rotate(0deg);
    }
    25% {
      transform: translateY(-2px) rotate(-1deg);
    }
    50% {
      transform: translateY(0) rotate(0deg);
    }
    75% {
      transform: translateY(2px) rotate(1deg);
    }
    100% {
      transform: translateY(0) rotate(0deg);
    }
  }

  animation: subtleMove 6s ease-in-out infinite;
`;

const styles = {
  grotContainer: css({
    position: 'fixed',
    bottom: 0,
    left: 0,
    zIndex: 99999,
  }),
  invisibleButton: css({
    border: 'none',
    background: 'transparent',
    margin: 0,
    padding: 0,
  }),
  grotWrapper: css({
    paddingTop: 12,
    fontSize: 14,
  }),
  actions: css({
    display: 'flex',
    justifyContent: 'space-around',
    marginTop: 8,
  }),
};

let highlighted: HTMLDivElement | undefined;

function handleMouseOver(e: MouseEvent) {
  if (e.target instanceof HTMLDivElement) {
    const target = getEventTarget(e.target);
    if (!target) {
      return;
    }
    target.style.outline = 'solid 1px orange';
    target.style.boxShadow = 'inset 0 0 10px 5px rgba(255, 0, 0, 0.8);';
    if (highlighted) {
      highlighted.style.outline = '';
      highlighted.style.boxShadow = '';
    }
    highlighted = target;
  }
}

function getEventTarget(element: HTMLDivElement, bubbled = 2) {
  const rect = element.getBoundingClientRect();
  if (rect.height < 39 || rect.width < 39) {
    if (bubbled - 1 >= 0 && element.parentElement instanceof HTMLDivElement) {
      return getEventTarget(element.parentElement, bubbled - 1);
    }
    return;
  }
  return element;
}

function scrapContext(element: HTMLDivElement, promptSuffix = ''): string {
  let context = 'Help me understand the following observability data:';

  if (document.title.startsWith('Explore')) {
    context = scrapExploreContext();
  }
  if (document.title.includes('Dashboards')) {
    context = scrapDashboardContext(element);
  }
  if (window.location.pathname === '/a/grafana-lokiexplore-app/explore') {
    context = scrapLogsAppContext();
  }

  console.log(`${context} ${promptSuffix}`.trimEnd());

  return `${context} ${promptSuffix}`.trimEnd();
}

function scrapExploreContext() {
  let context = "I'm in Grafana Explore. ";

  context += `${getTimeRangeContext()}. `;

  const queries: string[] = [];
  document.querySelectorAll('[data-testid="data-testid Query field"]').forEach((queryField) => {
    let query = '';
    queryField.querySelectorAll('.view-line span > span').forEach((span) => {
      query += span.innerHTML;
    });
    if (query) {
      queries.push(query.replaceAll('&nbsp;', ' '));
    }
  });

  context += `I'm running the following ${queries.length === 1 ? 'query' : 'queries'}:`;

  queries.forEach((query) => {
    context += '\n\n````\n' + query + '\n```\n\n';
  });

  context += 'Please help me interpret the following image from Grafana.';

  return context;
}

function scrapDashboardContext(element: HTMLDivElement) {
  let context = "I'm looking at a Grafana dashboard. ";

  context += `${getTimeRangeContext()}. `;

  if ($(element).parents('section').find('h2[title]').length) {
    context += `The graph title is ${$(element).parents('section').find('h2[title]').text()}. `;
  } else if ($(element).find('h2[title]').length) {
    context += `The graph title is ${$(element).find('h2[title]').text()}. `;
  }

  return context;
}

function getTimeRangeContext() {
  const picker = document.querySelector('[data-testid="data-testid TimePicker Open Button"]');
  return picker?.getAttribute('aria-label') ?? '';
}

function scrapLogsAppContext() {
  let context = '';

  if (window.location.pathname === '/a/grafana-lokiexplore-app/explore') {
    context =
      "I'm in the service selection page of the Grafana Logs App. I need to understand what I'm looking at and select a service of interest to investigate or diagnose using logging data.";
  }

  context += `${getTimeRangeContext()}. `;

  return context;
}

async function upload(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append('key', 'abc123');
  form.append('image', blob);

  return new Promise((resolve, reject) => {
    $.ajax({
      type: 'POST',
      url: 'https://matyax.com/hoverbot/upload.php',
      data: form,
      processData: false,
      contentType: false,
    })
      .done(function (data) {
        const response = JSON.parse(data);
        if (response?.url) {
          resolve(response.url);
          return;
        }
        console.error('Missing url');
        resolve('');
      })
      .catch((error) => {
        console.error(error);
        reject();
      });
  });
}

function getShorterSuffix() {
  return 'Please generate a specific but shorter explanation.';
}

function getSimplerSuffix() {
  return 'Explain it in simple terms.';
}

function getExtraSuffix() {
  return 'Using technical jargon, provide the most amount of details to help with my task.';
}

function getNextStepsSuffix() {
  return 'Give me a suggestion for the next steps to continue my investigation.';
}
