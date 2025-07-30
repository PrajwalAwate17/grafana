import { css } from '@emotion/css';

import { TableCellDisplayMode } from '../../types';
import { MaybeWrapWithLink } from '../MaybeWrapWithLink';
import { ImageCellProps, TableCellStyles } from '../types';

export const ImageCell = ({ cellOptions, field, height, value, rowIdx }: ImageCellProps) => {
  const { text } = field.display!(value);
  const { alt, title } =
    cellOptions.type === TableCellDisplayMode.Image ? cellOptions : { alt: undefined, title: undefined };

  return (
    <MaybeWrapWithLink field={field} rowIdx={rowIdx}>
      <img style={{ height }} alt={alt} src={text} title={title} />
    </MaybeWrapWithLink>
  );
};

export const getStyles: TableCellStyles = () =>
  css({
    img: {
      width: 'auto',
    },
  });
