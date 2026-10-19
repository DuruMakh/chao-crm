/* A4 PDF from the same text and table values shown in the invoice preview. */
var InvoicePdf = (() => {
    function filename(number) {
        const safe = String(number).trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 80);
        return `Chao-Invoice-${safe || 'draft'}.pdf`;
    }

    function build(invoice, fonts) {
        const {jsPDF} = typeof module !== 'undefined' ? require('./vendor/jspdf.umd.min.js') : window.jspdf;
        const drawTable = typeof module !== 'undefined' ? require('./vendor/jspdf.plugin.autotable.min.js').autoTable : window.autoTable;
        const pdf = new jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
        for (const style of ['normal','bold']) {
            pdf.addFileToVFS(`${style}.ttf`, fonts[style]);
            pdf.addFont(`${style}.ttf`, 'NotoGeorgian', style);
        }
        pdf.setProperties({title:`Chao Catering - Invoice ${invoice.number}`,author:'Chao Catering'});
        const orange = [235, 83, 0], ink = [30, 30, 35], left = 14, right = 196;
        function text(value, x, y, width, size=9, style='normal', color=ink, align='left') {
            pdf.setFont('NotoGeorgian', style); pdf.setFontSize(size); pdf.setTextColor(...color);
            const lines = pdf.splitTextToSize(String(value), width);
            pdf.text(lines, x, y, {align,lineHeightFactor:1.35});
            return y + lines.length * size * .3528 * 1.35;
        }

        const logo = pdf.getImageProperties(fonts.logo);
        pdf.addImage(fonts.logo, 'PNG', left, 14, 20 * logo.width / logo.height, 20);
        text('ინვოისი', right, 26, 90, 22, 'bold', orange, 'right');
        pdf.setDrawColor(...orange); pdf.setLineWidth(.5); pdf.line(left, 38, right, 38);

        let sellerY = text('გამყიდველი:', left, 47, 94, 9, 'bold', orange);
        invoice.supplier.forEach((line, i) => {sellerY = text(line, left, sellerY + 1, 94, i ? 8.5 : 10, i ? 'normal' : 'bold');});
        let metaY = 47;
        for (const line of [`ინვოისის №: ${invoice.number}`, `თარიღი: ${invoice.date}`, `შესრულების თარიღი: ${invoice.dueDate}`]) {
            metaY = text(line, right, metaY, 78, 8.5, 'normal', ink, 'right') + 2;
        }

        let y = Math.max(sellerY, metaY) + 8;
        pdf.setFont('NotoGeorgian','bold'); pdf.setFontSize(10);
        const payerLines = pdf.splitTextToSize(invoice.payerName, 170);
        const payerHeight = 18 + payerLines.length * 4.8;
        pdf.setFillColor(248,248,249); pdf.setDrawColor(225,225,230); pdf.setLineWidth(.2);
        pdf.roundedRect(left, y, right-left, payerHeight, 1, 1, 'FD');
        let payerY = text('გადამხდელი / მყიდველი:', left+5, y+6, 170, 9, 'bold', orange);
        payerY = text(invoice.payerName, left+5, payerY+1, 170, 10, 'bold');
        text(`ს/კ: ${invoice.payerId}`, left+5, payerY+1, 170, 8.5);
        y += payerHeight + 8;

        drawTable(pdf, {
            startY:y, margin:{top:16,right:14,bottom:18,left:14}, theme:'plain', rowPageBreak:'avoid',
            head:[invoice.head.map(cell=>({content:cell.text,styles:{halign:cell.align}}))],
            body:invoice.rows.map(row=>row.cells.map(cell=>({content:cell.text,colSpan:cell.span,
                styles:{halign:cell.align,...(row.total ? {fontStyle:'bold',fillColor:[248,248,249]} : {})}}))),
            styles:{font:'NotoGeorgian',fontStyle:'normal',fontSize:9,cellPadding:3,textColor:ink,
                lineColor:[225,225,230],lineWidth:{bottom:.2},overflow:'linebreak'},
            headStyles:{fillColor:orange,textColor:[255,255,255],fontStyle:'bold',fontSize:8.5},
            columnStyles:invoice.head.length === 5 ? {0:{cellWidth:70},1:{cellWidth:32},2:{cellWidth:28},3:{cellWidth:14},4:{cellWidth:38}} : {0:{cellWidth:14},1:{cellWidth:134},2:{cellWidth:34}},
        });
        y = pdf.lastAutoTable.finalY + 14;
        if (y > 265) {pdf.addPage(); y = 25;}
        pdf.setDrawColor(225,225,230); pdf.setLineWidth(.2); pdf.line(left,y,right,y);
        text('მადლობა თანამშრომლობისთვის!',left,y+7,105,8,'normal',[90,90,100]);
        pdf.setDrawColor(...ink); pdf.line(143,y+9,right,y+9);
        text('ხელმოწერა / ბეჭედი',right,y+14,55,8,'normal',[90,90,100],'right');
        const pages = pdf.getNumberOfPages();
        for (let page = 1; page <= pages; page++) {
            pdf.setPage(page);
            text(`${page} / ${pages}`,right,289,40,7,'normal',[110,110,120],'right');
        }
        return new Uint8Array(pdf.output('arraybuffer'));
    }
    return {build,filename};
})();
if (typeof module !== 'undefined') module.exports = InvoicePdf;
