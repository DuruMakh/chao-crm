/* Staff-only A4 PDF: logistics and quantities, without billing information. */
var StaffPdf = (() => {
    function filename(order) {
        const letters = 'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ';
        const latin = ['a','b','g','d','e','v','z','t','i','k','l','m','n','o','p','zh','r','s','t','u','p','k','gh','q','sh','ch','ts','dz','ts','ch','kh','j','h'];
        const name = (order.name || order.clientName).toLowerCase().replace(/[ა-ჰ]/g, letter=>latin[letters.indexOf(letter)])
            .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
            .slice(0, 80).replace(/^-+|-+$/g, '').replace(/^[a-z]/, letter=>letter.toUpperCase()) || 'Order';
        return `${name}${order.guests > 0 ? `-${order.guests}-People` : ''}.pdf`;
    }

    function build(order, fonts) {
        const {jsPDF} = typeof module !== 'undefined' ? require('./vendor/jspdf.umd.min.js') : window.jspdf;
        const drawTable = typeof module !== 'undefined' ? require('./vendor/jspdf.plugin.autotable.min.js').autoTable : window.autoTable;
        const pdf = new jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
        for (const style of ['normal','bold']) {
            pdf.addFileToVFS(`${style}.ttf`, fonts[style]);
            pdf.addFont(`${style}.ttf`, 'NotoGeorgian', style);
        }
        pdf.setProperties({title:filename(order).replace(/\.pdf$/, ''),author:'Chao Catering'});
        let y = 10;
        function table(options) {
            drawTable(pdf, {startY:y,margin:{top:10,right:10,bottom:16,left:10},theme:'plain',rowPageBreak:'avoid',
                styles:{font:'NotoGeorgian',fontStyle:'normal',fontSize:10,cellPadding:1.8,textColor:[30,30,35],overflow:'linebreak'},
                ...options});
            y = pdf.lastAutoTable.finalY + 4;
        }
        const value = input => input || 'დასაზუსტებელია';
        table({body:[[{content:order.name || order.clientName,styles:{fontStyle:'bold',fontSize:16,cellPadding:{bottom:3}}}]]});
        table({body:[
            [`თარიღი: ${value(order.eventDate ? order.eventDate.split('-').reverse().join('.') : '')}`,`დაწყება: ${value(order.eventTime)}`,`სტუმრები: ${value(order.guests)}`],
            [{content:`ადგილი / თვითგატანა: ${value(order.location)}`,colSpan:3}],
            [`კლიენტი: ${value(order.clientName)}`,`კომპანია: ${order.companyName || '—'}`,`ტელეფონი: ${value(order.phone)}`],
        ],columnStyles:{0:{cellWidth:63},1:{cellWidth:63},2:{cellWidth:64}}});
        if (order.items.length) table({
            head:[['პროდუქტი','რაოდენობა']],body:order.items.map(item=>[item.name,String(item.qty)]),
            headStyles:{fontStyle:'bold',fillColor:[241,241,245]},columnStyles:{1:{cellWidth:28,halign:'right',fontStyle:'bold'}},
            bodyStyles:{lineColor:[210,210,216],lineWidth:{bottom:.2}},
        });
        else table({body:[['მენიუ ჯერ არ არის დამატებული.']]});
        if (order.notes) table({head:[['შენიშვნები']],body:[[order.notes]],headStyles:{fontStyle:'bold'},pageBreak:'avoid'});
        const updated = new Date(order.updatedAt);
        const updatedText = Number.isNaN(updated.getTime()) ? '' : 'განახლდა: ' + new Intl.DateTimeFormat('en-GB', {dateStyle:'short',timeStyle:'short',timeZone:'Asia/Tbilisi'}).format(updated);
        table({body:[[`შეკვეთა: ${order.id}`,updatedText]],bodyStyles:{fontSize:8,textColor:[90,90,100]},columnStyles:{1:{halign:'right'}}});
        const pages = pdf.getNumberOfPages();
        for (let page = 1; page <= pages; page++) {
            pdf.setPage(page); pdf.setFont('NotoGeorgian','normal'); pdf.setFontSize(8); pdf.setTextColor(90,90,100);
            pdf.text(`${page} / ${pages}`,200,289,{align:'right'});
        }
        return new Uint8Array(pdf.output('arraybuffer'));
    }
    return {build,filename};
})();
if (typeof module !== 'undefined') module.exports = StaffPdf;
