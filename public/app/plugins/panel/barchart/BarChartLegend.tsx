import { memo } from 'react';

import {
  DataFrame,
  Field,
  FieldColorModeId,
  getFieldSeriesColor,
  ThresholdsConfig,
  ThresholdsMode,
  ValueMapping,
} from '@grafana/data';
import { VizLegendOptions, AxisPlacement } from '@grafana/schema';
import { UPlotConfigBuilder, VizLayout, VizLayoutLegendProps, VizLegend, VizLegendItem, useTheme2 } from '@grafana/ui';
import { getDisplayValuesForCalcs } from '@grafana/ui/src/components/uPlot/utils';
// import { getFieldLegendItem } from 'app/core/components/TimelineChart/utils';
import { getThresholdItems2, getValueMappingItems } from 'app/core/components/TimelineChart/utils';
interface BarChartLegend2Props extends VizLegendOptions, Omit<VizLayoutLegendProps, 'children'> {
  data: DataFrame[];
  colorField?: Field | null;
  // config: UPlotConfigBuilder;
}

/**
 * mostly duplicates logic in PlotLegend below :(
 *
 * @internal
 */
export function hasVisibleLegendSeries(config: UPlotConfigBuilder, data: DataFrame[]) {
  return data[0].fields.slice(1).some((field) => !Boolean(field.config.custom?.hideFrom?.legend));

  // return config.getSeries().some((s, i) => {
  //   const frameIndex = 0;
  //   const fieldIndex = i + 1;
  //   const field = data[frameIndex].fields[fieldIndex];
  //   return !Boolean(field.config.custom?.hideFrom?.legend);
  // });
}

export const BarChartLegend = memo(
  ({ data, placement, calcs, displayMode, colorField, ...vizLayoutLegendProps }: BarChartLegend2Props) => {
    const theme = useTheme2();

    // if (colorField != null) {
    //   const items = getFieldLegendItem([colorField], theme);

    //   if (items?.length) {
    //     return (
    //       <VizLayout.Legend placement={placement}>
    //         <VizLegend placement={placement} items={items} displayMode={displayMode} />
    //       </VizLayout.Legend>
    //     );
    //   }
    // }

    const fieldConfig = data[0].fields[0].config;
    const colorMode = fieldConfig.color?.mode;

    let thresholdItems: VizLegendItem[] | undefined = undefined;
    // calculate threshold items only if color mode is set to Thresholds
    if (colorMode === FieldColorModeId.Thresholds) {
      const thresholdsAbsolute: ThresholdsConfig = { mode: ThresholdsMode.Absolute, steps: [] };
      const thresholdsPercent: ThresholdsConfig = { mode: ThresholdsMode.Percentage, steps: [] };

      for (let i = 0; i < data[0].fields.length; i++) {
        const thresholds = data[0].fields[i].config.thresholds;

        // in case of multiple fields, each field has same thresholds config as in first field (data[0].field[0].config),
        // so we need to avoid duplicates;
        // it is the same object, so we can compare by reference;
        // i !== 0 is needed to add thresholds from the first field
        if (thresholds) {
          if ((i === 0 || fieldConfig.thresholds !== thresholds) && thresholds.steps.length > 1) {
            if (thresholds.mode === ThresholdsMode.Absolute) {
              thresholdsAbsolute.steps.push(...thresholds.steps);
            } else {
              thresholdsPercent.steps.push(...thresholds.steps);
            }
          }
        }
      }

      const thresholdAbsoluteItems: VizLegendItem[] = getThresholdItems2(fieldConfig, thresholdsAbsolute, theme);
      const thresholdPercentItems: VizLegendItem[] = getThresholdItems2(fieldConfig, thresholdsPercent, theme);
      thresholdItems = [...thresholdAbsoluteItems, ...thresholdPercentItems];
    }

    const mappings: ValueMapping[] = [];
    const baseMapping = data[0].fields[0].config.mappings;
    if (baseMapping) {
      mappings.push(...baseMapping);
    }
    for (let i = 1; i < data[0].fields.length; i++) {
      const mapping = data[0].fields[i].config.mappings;
      if (mapping && mapping !== baseMapping) {
        mappings.push(...mapping);
      }
    }
    const valueMappingItems: VizLegendItem[] = getValueMappingItems(mappings, theme);

    const legendItems = data[0].fields
      .slice(1)
      .map((field, i) => {
        const frameIndex = 0;
        const fieldIndex = i + 1;
        // const axisPlacement = config.getAxisPlacement(s.props.scaleKey); // TODO: this should be stamped on the field.config?
        // const field = data[frameIndex].fields[fieldIndex];

        if (!field || field.config.custom?.hideFrom?.legend) {
          return undefined;
        }

        // // apparently doing a second pass like this will take existing state.displayName, and if same as another one, appends counter
        // const label = getFieldDisplayName(field, data[0], data);
        const label = field.state?.displayName ?? field.name;

        const color = getFieldSeriesColor(field, theme).color;

        const item: VizLegendItem = {
          disabled: field.state?.hideFrom?.viz,
          color,
          label,
          yAxis: field.config.custom?.axisPlacement === AxisPlacement.Right ? 2 : 1,
          getDisplayValues: () => getDisplayValuesForCalcs(calcs, field, theme),
          getItemKey: () => `${label}-${frameIndex}-${fieldIndex}`,
        };

        return item;
      })
      .filter((i): i is VizLegendItem => i !== undefined);

    return (
      <VizLayout.Legend placement={placement} {...vizLayoutLegendProps}>
        <VizLegend
          placement={placement}
          items={legendItems}
          thresholdItems={thresholdItems}
          mappingItems={valueMappingItems}
          displayMode={displayMode}
          sortBy={vizLayoutLegendProps.sortBy}
          sortDesc={vizLayoutLegendProps.sortDesc}
          isSortable={true}
        />
      </VizLayout.Legend>
    );
  }
);

BarChartLegend.displayName = 'BarChartLegend';
